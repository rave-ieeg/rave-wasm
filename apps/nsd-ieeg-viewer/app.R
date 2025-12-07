if(dipsaus::rs_avail() && !is.na(dipsaus::rs_active_project())) {
  local({
    ctx <- rstudioapi::getSourceEditorContext()
    if(length(ctx$path) == 1) {
      setwd(dirname(ctx$path))
    }
  })
  library(ieegio)
  library(bidsr)
}
source("www/r/shiny-helper.r", local = TRUE, chdir = FALSE)
source("www/r/coordinate-helper.r", local = TRUE, chdir = FALSE)


# check if there is a .urlParams file
this_env <- environment()
initial_space <- "fsaverage (MNI305)"
initial_space_forced <- FALSE
initial_electrode_path <- NULL
if(file.exists("./.urlParams")) {
  try({
    params <- dipsaus::read_json("./.urlParams")
    if(length(params$space)) {
      initial_space_forced <- TRUE
    }
    params$space <- match.arg(params$space, c("MNI305", "MNI152", "native"))
    initial_space <- switch (
      params$space,
      "native" = "native subject",
      "MNI152" = "MNI152",
      "fsaverage (MNI305)"
    )
    if(length(params$electrode_path)) {
      initial_electrode_path <- params$electrode_path[[1]]
    }
    # electrode_path=https%3A%2F%2Fraw.githubusercontent.com%2Frave-ieeg%2Frave-wasm%2Frefs%2Fheads%2Fmain%2Fassets%2Fapp-data%2Fbids-examples%2FNSD-electrodes%2Fsub-06_ses-ieeg01_space-MNI152NLin2009_electrodes.tsv
  }, silent = TRUE)
}


ui <- function() {
  bslib_page_template(
    fluid = TRUE,
    sidebar = shiny::tagList(
      shiny::column(
        width = 12L,
        shiny::h5("STEP 1:"),
        shiny::fileInput(
          inputId = ns("electrode_coord"),
          label = "Electrode coordinate"
        )
      ),
      shiny::column(
        width = 12L,
        shiny::h5("STEP 2:"),
        shiny::selectInput(
          inputId = ns("coordinate_space"),
          label = "Choose a brain model",
          choices = c("fsaverage (MNI305)", "MNI152", "native subject"),
          selected = initial_space
        ),
        shiny::conditionalPanel(
          ns = ns, condition = "input['coordinate_space'] === 'native subject'",
          dipsaus::fancyDirectoryInput(
            inputId = ns("directory"),
            label = "Native-subject's FreeSurfer",
            after_content = "FreeSurfer directory",
            size = "s",
            maxSize = 50 * 1024^2,
            width = "100%",
            autoCleanup = TRUE,
            autoCleanupLocked = TRUE,
            progress = TRUE
          )
        )
      ),
      shiny::column(
        width = 12L,
        dipsaus::actionButtonStyled(
          inputId = ns("render"),
          label = "Rendering it!",
          width = "100%"
        )
      ),
      shiny::column(
        width = 12L,
        shiny::h5("STEP 3 (optional):"),
        shiny::fileInput(
          inputId = ns("electrode_value"),
          label = "Electrode values"
        )
      ),
      shiny::column(
        width = 12L,
        shiny::h5("STEP 4:"),
        wasm_download_button(
          inputId = ns("download"),
          label = "Export viewer",
          style = "width:100%",
          class = "btn btn-default"
        )
      )
    ),
    
    # content ...
    threeBrain::threejsBrainOutput(
      outputId = ns("viewer"),
      width = "100%",
      height = "100%",
      reportSize = TRUE
    )
  )
}

server <- function(input, output, session) {
  
  local_reactive <- shiny::reactiveValues(
    needs_update = FALSE
  )
  local_data <- new.env(parent = emptyenv())
  
  dipsaus::observeDirectoryProgress("directory", session = session)
  brain_proxy <- threeBrain::brain_proxy(outputId = "viewer", session = session)
  
  # Load electrode table
  load_coord_table <- function(coordinate_file, filename = basename(coordinate_file)) {
    parsed <- parse_electrode_coordinate(coordinate_file, filename = filename)
    
    # Check if MNI305 is available, then MNI152, then native
    brain_model <- "native subject"
    if("MNI305" %in% parsed$coord_sys) {
      brain_model <- "fsaverage (MNI305)"
    } else if ("MNI152" %in% parsed$coord_sys) {
      brain_model <- "MNI152"
    }
    local_data$parsed_coordinates <- parsed
    if(initial_space_forced) {
      this_env$initial_space_forced <- FALSE
    } else {
      shiny::updateSelectInput(session = session, inputId = "coordinate_space", selected = brain_model)
    }
  }
  
  # Parse user input coordinate file
  shiny::bindEvent(
    safe_observe({
      electrode_coord <- input$electrode_coord
      if(is.null(electrode_coord)) {
        # give users a default one
        if(!length(initial_electrode_path)) {
          initial_electrode_path <- request_asset('bids-examples/NSD-electrodes/sub-06_ses-ieeg01_space-MNI305_electrodes.tsv')
        }
        load_coord_table(initial_electrode_path)
        local_reactive$force_render <- Sys.time()
      } else {
        load_coord_table(electrode_coord$datapath, filename = electrode_coord$name)
      }
    }),
    input$electrode_coord,
    ignoreNULL = FALSE, ignoreInit = FALSE
  )
  
  set_coordsys <- function(coord_space) {
    switch (
      coord_space,
      "fsaverage (MNI305)" = {
        load_shared_assets(
          manifest_name = "freesurfer-models/fsaverage_manifest.json",
          callback = function(...) {
            load_brain("../../assets/app-data/freesurfer-models/fsaverage/", "MNI305")
          }
        )
      },
      "MNI152" = {
        load_shared_assets(
          manifest_name = "freesurfer-models/cvs_avg35_inMNI152_manifest.json",
          callback = function(...) {
            load_brain("../../assets/app-data/freesurfer-models/cvs_avg35_inMNI152/", "MNI152")
          }
        )
      },
      {
        load_brain(local_data$native_fs_path)
      }
    )
  }
  
  shiny::bindEvent(
    safe_observe({
      set_coordsys(input$coordinate_space)
    }),
    input$render,
    ignoreNULL = TRUE, ignoreInit = TRUE
  )
  
  shiny::bindEvent(
    safe_observe({
      set_coordsys(input$coordinate_space)
    }),
    local_reactive$force_render, 
    ignoreNULL = TRUE, ignoreInit = FALSE
  )
  
  shiny::bindEvent(
    safe_observe({
      files <- input$directory
      upload_dir <- attr(files, "upload_dir")
      if(
        is.null(files) ||
        !identical(attr(files, "upload_status"), "completed") ||
        length(upload_dir) != 1 || is.na(upload_dir)
      ) {
        return()
      }
      included_dirs <- list.dirs(upload_dir, full.names = FALSE, recursive = FALSE)
      included_dirs <- included_dirs[vapply(included_dirs, function(dname) {
        if(startsWith(dname, ".")) { return(FALSE) }
        return(threeBrain::check_freesurfer_path(file.path(upload_dir, dname)))
        # return(file.exists(file.path(upload_dir, dname, "mri")))
      }, FUN.VALUE = FALSE)]
      if(length(included_dirs)) {
        included_dirs <- included_dirs[[1]]
      } else {
        # single file?
        included_files <- list.files(
          upload_dir,
          pattern = "\\.(nii|nii\\.gz|mgz)$",
          all.files = FALSE,
          full.names = FALSE,
          recursive = TRUE,
          include.dirs = FALSE, 
          ignore.case = TRUE
        )
        if(!length(included_files)) {
          message("Invalid brain files")
          shiny::showNotification("Invalid uploads. Please load one NIfTI file (.nii, .nii.gz, or .mgz) or a FreeSurfer folder (containing mri/, surf/, ...)", type = "error")
          return()
        }
        included_files <- file.path(upload_dir, included_files[[1]])
        dir.create(file.path(upload_dir, "fs", "mri"), showWarnings = FALSE, recursive = TRUE)
        ext <- file_ext(included_files)
        file.rename(from = included_files,
                    to = file.path(upload_dir, "fs", "mri", sprintf("rave_slices%s", ext)))
        included_dirs <- "fs"
      }
      subject_fspath <- file.path(upload_dir, included_dirs)
      
      local_data$native_fs_path <- subject_fspath
      # 
      # local_reactive$needs_update <- Sys.time()
      # local_data$coord_table <- NULL
      # local_data$value_table <- NULL
      # local_data$brain <- threeBrain::threeBrain(path = subject_fspath,
      #                                            subject_code = included_dirs,
      #                                            surface_types = "inflated")
      # set_brain()
    }),
    input$directory, 
    ignoreNULL = TRUE, ignoreInit = TRUE
  )
  
  load_brain <- function(fs_path, type = c("scannerRAS", "MNI152", "MNI305")) {
    if(length(fs_path) != 1 || !dir.exists(fs_path)) { return() }
    type <- match.arg(type)
    brain <- threeBrain::threeBrain(
      path = fs_path,
      subject_code = basename(fs_path),
      surface_types = c("inflated", "sphere", "sphere.reg")
    )
    if(is.null(brain)) { return() }
    # get pial and sphere.reg paths
    pial_datanames <- names(brain$surfaces$pial$group$group_data)
    pial_lh_name <- pial_datanames[startsWith(pial_datanames, "free_vertices_FreeSurfer Left")]
    pial_rh_name <- pial_datanames[startsWith(pial_datanames, "free_vertices_FreeSurfer Right")]
    
    
    sphere.reg_datanames <- names(brain$surfaces$sphere.reg$group$group_data)
    sphere.reg_lh_name <- sphere.reg_datanames[startsWith(sphere.reg_datanames,
                                                          "free_vertices_FreeSurfer Left")]
    sphere.reg_rh_name <- sphere.reg_datanames[startsWith(sphere.reg_datanames,
                                                          "free_vertices_FreeSurfer Right")]
    
    surface_normalization_needed <- FALSE
    if(
      length(pial_lh_name) > 0 &&
      length(pial_rh_name) > 0 &&
      length(sphere.reg_lh_name) > 0 &&
      length(sphere.reg_rh_name) > 0
    ) {
      pial_lh_name <- pial_lh_name[[1]]
      pial_rh_name <- pial_rh_name[[1]]
      sphere.reg_lh_name <- sphere.reg_lh_name[[1]]
      sphere.reg_rh_name <- sphere.reg_rh_name[[1]]
      surface_normalization_needed <- TRUE
    }
    
    # calculate sphere.reg xyz
    
    parsed_coordinates <- as.list(local_data$parsed_coordinates)
    coords <- parsed_coordinates[[type]]
    coord_table <- parsed_coordinates$table
    
    # check if the coordinate exists
    if(surface_normalization_needed &&
       all(c("Sphere_x", "Sphere_y", "Sphere_z", "DistanceShifted", "Hemisphere") %in% 
           names(coord_table))) {
      surface_normalization_needed <- FALSE
    }
    if(surface_normalization_needed && 
       length(parsed_coordinates$coord_sys) && 
       length(coords)) {
      
      coords[!complete.cases(coords), ] <- 0
      isvalid <- rowSums(coords^2) > 0
      
      pial_lh_path <- brain$surfaces$pial$group$group_data[[pial_lh_name]]$absolute_path
      pial_rh_path <- brain$surfaces$pial$group$group_data[[pial_rh_name]]$absolute_path
      sphere.reg_lh_path <- brain$surfaces$sphere.reg$group$group_data[[sphere.reg_lh_name]]$absolute_path
      sphere.reg_rh_path <- brain$surfaces$sphere.reg$group$group_data[[sphere.reg_rh_name]]$absolute_path
      
      # read in pial and sphere.reg
      pial_lh <- ieegio::read_surface(pial_lh_path)
      pial_lh_verts <- pial_lh$geometry$transforms[[1]] %*% pial_lh$geometry$vertices
      pial_lh_verts <- pial_lh_verts[1:3, , drop = FALSE]
      
      pial_rh <- ieegio::read_surface(pial_rh_path)
      pial_rh_verts <- pial_rh$geometry$transforms[[1]] %*% pial_rh$geometry$vertices
      pial_rh_verts <- pial_rh_verts[1:3, , drop = FALSE]
      
      sphere.reg_lh <- ieegio::read_surface(sphere.reg_lh_path)
      sphere.reg_lh_verts <- sphere.reg_lh$geometry$vertices
      
      sphere.reg_rh <- ieegio::read_surface(sphere.reg_rh_path)
      sphere.reg_rh_verts <- sphere.reg_rh$geometry$vertices
      
      sphere_coords <- apply(as.matrix(coords), 1, function(x) {
        if(sum(x^2) == 0) {
          return(data.frame(
            Sphere_x = 0,
            Sphere_y = 0,
            Sphere_z = 0,
            DistanceShifted = 0,
            Hemisphere = NA
          ))
        }
        
        # calculate closest node
        dist_l <- colSums((pial_lh_verts - x)^2)
        idx_l <- which.min(dist_l)
        dist_l <- sqrt(dist_l[idx_l])
        
        dist_r <- colSums((pial_rh_verts - x)^2)
        idx_r <- which.min(dist_r)
        dist_r <- sqrt(dist_r[idx_r])
        
        if(dist_l < dist_r) {
          s <- sphere.reg_lh_verts[, idx_l]
          return(data.frame(
            Sphere_x = s[[1]],
            Sphere_y = s[[2]],
            Sphere_z = s[[3]],
            DistanceShifted = sqrt(dist_l),
            Hemisphere = "Left"
          ))
        } else {
          s <- sphere.reg_rh_verts[, idx_r]
          return(data.frame(
            Sphere_x = s[[1]],
            Sphere_y = s[[2]],
            Sphere_z = s[[3]],
            DistanceShifted = sqrt(dist_r),
            Hemisphere = "Right"
          ))
        }
        
      }, simplify = FALSE)
      sphere_coords <- do.call("rbind", sphere_coords)
      
      coord_table$Sphere_x <- sphere_coords$Sphere_x
      coord_table$Sphere_y <- sphere_coords$Sphere_y
      coord_table$Sphere_z <- sphere_coords$Sphere_z
      coord_table$DistanceShifted <- sphere_coords$DistanceShifted
      coord_table$Hemisphere <- sphere_coords$Hemisphere
      
    }
    
    position_names <- names(parsed_coordinates[[type]])
    if(!length(position_names)) {
      position_names <- c("x", "y", "z")
    }
    coord_table$Subject <- NULL
    coord_table$SubjectCode <- NULL
    brain$set_electrodes(
      electrodes = coord_table,
      coord_sys = type,
      position_names = position_names,
      priority = "sphere"
    )
    
    local_data$brain <- brain
    local_reactive$needs_update <- Sys.time()
  }
  
  shiny::bindEvent(
    safe_observe({
      csv_path <- input$electrode_coord$datapath[[1]]
      if(file_ext(csv_path) == ".tsv") {
        # BIDS
        value_table <- read.table(csv_path, header = TRUE, sep = "\t", na.strings = "n/a")
      } else {
        # native
        value_table <- read.csv(csv_path)
      }
      nr <- nrow(value_table)
      if(!nr) { return() }
      coord_table <- local_data$coord_table
      if(!length(value_table$Electrode)) {
        # Try to match labels
        value_table$Label <- value_table$name %||% value_table$Label %||% value_table$label
        if(length(value_table$Label)) {
          merged <- merge(value_table, coord_table, by = "Label", all = TRUE, suffixes = c("", ".dontuse"))
          value_table <- merged[, unique(c(names(value_table), "Electrode"))]
        } else {
          value_table$Electrode <- seq_len(nrow(value_table))
        }
      }
      value_table$Subject <- NULL
      value_table$SubjectCode <- NULL
      local_data$value_table <- value_table
      set_brain()
      brain_proxy$set_electrode_data(value_table, clear_first = TRUE)
      # local_reactive$needs_update <- Sys.time()
    }),
    input$electrode_value, ignoreNULL = TRUE, ignoreInit = TRUE
  )
  
  output$viewer <- threeBrain::renderBrain({
    shiny::validate(
      shiny::need(!isFALSE(local_reactive$needs_update), 
      message = "Please set brain and click on start rendering")
    )
    
    brain <- local_data$brain
    if(is.null(brain)) {
      if(coord_space == "native subject") {
        stop("Please load a NIfTI file or a FreeSurfer folder first!")
      } else {
        stop("Loading brain model, please wait...")
      }
    }
    brain$render(
      outputId = "viewer",
      session = session,
      show_modal = FALSE,
      side_canvas = TRUE
    )
  })
  
  # shiny::bindEvent(
  #   safe_observe({
  #     message("Preparing viewer for download")
  #     brain <- set_brain()
  #     if(is.null(brain)) {
  #       shiny::showNotification("Invalid viewer files. Please load the NIfTI/FreeSurfer files.", type = "error")
  #       return()
  #     }
  #     
  #     # Generate viewer HTML
  #     viewer <- brain$render(outputId = "viewer", session = session, show_modal = FALSE)
  #     tfpath <- tempfile(fileext = ".html")
  #     threeBrain::save_brain(viewer, title = "RAVE Viewer", path = tfpath)
  #     
  #     # Stream file to client and cleanup
  #     wasm_send_file_download(
  #       session = session,
  #       filepath = tfpath,
  #       filename = "RAVEViewer.html",
  #       cleanup = TRUE
  #     )
  #   }),
  #   input$download,
  #   ignoreNULL = TRUE,
  #   ignoreInit = TRUE
  # )
}

start_app(ui(), server)
