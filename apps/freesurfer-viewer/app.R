source("www/r/shiny-helper.r", local = TRUE, chdir = FALSE)

ui <- bslib_page_template(
  fluid = TRUE,
  sidebar = shiny::tagList(
    shiny::column(
      width = 12L,
      shiny::h3("STEP 1:"),
      dipsaus::fancyDirectoryInput(
        inputId = ns("directory"),
        label = "Imaging folder/file",
        after_content = "T1 MRI or FreeSurfer directory",
        size = "s",
        maxSize = 50 * 1024^2,
        width = "100%",
        autoCleanup = TRUE,
        autoCleanupLocked = TRUE,
        progress = TRUE
      )
    ),
    shiny::column(
      width = 12L,
      shiny::h3("STEP 2:"),
      shiny::fileInput(
        inputId = ns("electrode_coord"),
        label = "Electrode coordinate"
      )
    ),
    shiny::column(
      width = 12L,
      shiny::h3("STEP 3:"),
      shiny::fileInput(
        inputId = ns("electrode_value"),
        label = "Electrode values"
      )
    ),
    shiny::column(
      width = 12L,
      shiny::h3("STEP 4:"),
      wasm_download_button(
        inputId = ns("download"),
        label = "Export viewer",
        style = "width:100%"
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

server <- function(input, output, session) {
  
  local_reactive <- shiny::reactiveValues(
    needs_update = FALSE
  )
  local_data <- new.env(parent = emptyenv())
  
  dipsaus::observeDirectoryProgress("directory", session = session)
  brain_proxy <- threeBrain::brain_proxy(outputId = "viewer", session = session)
  
  set_brain <- function() {
    if(is.null(local_data$brain)) {
      message("No brain models")
      return(local_data$brain)
    }
    coord_table <- local_data$coord_table
    if(!is.data.frame(coord_table) || !nrow(coord_table)) {
      message("No coordinate table")
      return(local_data$brain)
    }
    coord_sys <- local_data$coord_sys
    if(!length(coord_sys)) {
      coord_sys <- "scannerRAS"
    }
    message("Setting electrodes in coordinate system: ", coord_sys)
    local_data$brain$set_electrodes(local_data$coord_table, coord_sys = coord_sys)
    local_data$brain$set_electrode_values()
    
    value_table <- local_data$value_table
    if(is.data.frame(value_table) && nrow(value_table)) {
      message("Setting electrode values")
      # print(value_table)
      local_data$brain$set_electrode_values(value_table)
    }
    return(local_data$brain)
  }
  
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
      
      local_reactive$needs_update <- Sys.time()
      local_data$coord_table <- NULL
      local_data$value_table <- NULL
      local_data$brain <- threeBrain::threeBrain(path = subject_fspath,
                                                 subject_code = included_dirs,
                                                 surface_types = "inflated")
      set_brain()
    }),
    input$directory, 
    ignoreNULL = TRUE, ignoreInit = TRUE
  )
  
  shiny::bindEvent(
    safe_observe({
      csv_path <- input$electrode_coord$datapath[[1]]
      if(file_ext(csv_path) == ".tsv") {
        # BIDS
        coord_table <- read.table(csv_path, header = TRUE, sep = "\t", na.strings = "n/a")
      } else {
        # native
        coord_table <- read.csv(csv_path)
      }
      nr <- nrow(coord_table)
      if(!nr) {
        return()
      }
      if(!length(coord_table$Electrode)) {
        coord_table$Electrode <- coord_table$Channel %||% coord_table$channel %||% seq_len(nr)
      }
      if(!length(coord_table$Label)) {
        coord_table$Label <- coord_table$name %||% coord_table$label %||% sprintf("Unknown%04d", seq_len(nr))
      }
      nms <- names(coord_table)
      if(all(c("Coord_x", "Coord_y", "Coord_z") %in% nms)) {
        coord_sys <- "tkrRAS"
      } else if(all(c("T1R", "T1A", "T1S") %in% nms)) {
        coord_sys <- "scannerRAS"
      } else if(all(c("MNI305_x", "MNI305_y", "MNI305_z") %in% nms)) {
        coord_sys <- "MNI305"
      } else if(all(c("MNI152_x", "MNI152_y", "MNI152_z") %in% nms)) {
        coord_sys <- "MNI152"
      } else if(all(c("x", "y", "z") %in% nms)) {
        coord_sys <- "scannerRAS"
      } else {
        shiny::showNotification("Invalid coordinate table: must contains `x`, `y`, `z` columns (T1 scanner RAS) or from RAVE/YAEL electrodes.csv (contains `T1R`, `T1A`, `T1S` columns)", type = "error")
        return()
      }
      coord_table$Subject <- NULL
      coord_table$SubjectCode <- NULL
      local_data$coord_table <- coord_table
      local_data$coord_sys <- coord_sys
      set_brain()
      local_reactive$needs_update <- Sys.time()
    }),
    input$electrode_coord, ignoreNULL = TRUE, ignoreInit = TRUE
  )
  
  shiny::bindEvent(
    safe_observe({
      csv_path <- input$electrode_value$datapath[[1]]
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
    shiny::validate(shiny::need(!isFALSE(local_reactive$needs_update),
      message = "Please drag & drop a NIfTI/FreeSurfer folder"
    ))
    brain <- local_data$brain
    if(is.null(brain)) {
      stop("Please load a NIfTI file or a FreeSurfer folder first!")
    }
    brain$render(outputId = "viewer", session = session, show_modal = FALSE, side_canvas = TRUE)
  })
  
  shiny::bindEvent(
    safe_observe({
      message("Preparing viewer for download")
      brain <- set_brain()
      if(is.null(brain)) {
        shiny::showNotification("Invalid viewer files. Please load the NIfTI/FreeSurfer files.", type = "error")
        return()
      }
      
      # Generate viewer HTML
      viewer <- brain$render(outputId = "viewer", session = session, show_modal = FALSE)
      tfpath <- tempfile(fileext = ".html")
      threeBrain::save_brain(viewer, title = "RAVE Viewer", path = tfpath)
      
      # Stream file to client and cleanup
      wasm_send_file_download(
        session = session,
        filepath = tfpath,
        filename = "RAVEViewer.html",
        cleanup = TRUE
      )
    }),
    input$download,
    ignoreNULL = TRUE,
    ignoreInit = TRUE
  )
}

start_app(ui, server)
