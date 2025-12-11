# NOTE: This file is located in www/r/ and is symlinked to from apps/*/www/
# When updating this file, changes will affect ALL apps that use it.
# The symlink structure: apps/*/www -> /project_root/www/

if(FALSE) {
  # trigger WASM
  library(shiny)
  library(threeBrain)
  library(dipsaus)
  library(yaml)
  library(bslib)
}

build_info <- dipsaus::read_json("www/build-manifest.json", simplifyVector = TRUE)

if(file.exists("manifest.yaml")) {
  module_info <- yaml::read_yaml("manifest.yaml")
} else {
  module_info <- list(app_id = "home")
}

module_id <- module_info$app_id
module_title <- module_info$app_title
module_description <- module_info$app_description
ns <- shiny::NS(module_id)

# also get citation information
CITATION <- utils::citation("threeBrain")
if(file.exists("./CITATION")) {
  CITATION <- c(utils::readCitationFile("CITATION"), CITATION)
}

work_path <- getwd()

safe_wrap_expr <- function (expr, onFailure = NULL, finally = {}) {
  expr_ <- substitute(expr)
  parent_frame <- parent.frame()
  current_env <- getOption("rlang_trace_top_env", NULL)
  options(rlang_trace_top_env = parent_frame)
  on.exit({
    options(rlang_trace_top_env = current_env)
  })
  tryCatch({
    eval(expr_, envir = parent_frame)
  }, error = function(e) {
    if (is.function(onFailure)) {
      try({
        onFailure(e)
      })
    }
    shiny::showNotification(
      type = "error",
      closeButton = TRUE,
      duration = NULL,
      ui = shiny::p(paste(e$message, collapse = "\n"))
    )
  }, finally = try({
    finally
  }))
}

safe_observe <- function (x, env = NULL, quoted = FALSE, priority = 0L, domain = NULL, 
          ..., error_wrapper = c("none", "notification", "alert"))
{
  error_wrapper <- match.arg(error_wrapper)
  if (!quoted) {
    x <- substitute(x)
  }
  switch(error_wrapper, none = {
    x <- bquote({
      safe_wrap_expr(.(x), onFailure = function(...) {})
    })
  }, notification = {
    x <- bquote({
      safe_wrap_expr(.(x))
    })
  }, alert = {
    x <- bquote({
      safe_wrap_expr(
        .(x),
        onFailure = function(e) {
          dipsaus::shiny_alert2(
            title = "Error",
            text = paste(e$message, collapse = " \n"),
            icon = "error",
            danger_mode = TRUE,
            auto_close = FALSE,
            buttons = TRUE
          )
        }
      )
    })
  })
  if (!is.environment(env)) {
    env <- parent.frame()
  }
  if (is.null(domain)) {
    domain <- shiny::getDefaultReactiveDomain()
  }
  shiny::observe(x = x, env = env, quoted = TRUE, priority = priority, 
                 domain = domain, ...)
}

# For debugging
safe_observe <- shiny::observe

reconstruct_directory <- function(directory_data, root_dir = tempfile()) {
  directory_data <- as.data.frame(directory_data)
  dir.create(root_dir, showWarnings = FALSE, recursive = TRUE)
  root_dir <- normalizePath(root_dir, winslash = "/", mustWork = TRUE)
  total_n <- nrow(directory_data)
  res <- lapply(seq_len(total_n), function(ii) {
    row_df <- directory_data[ii, ]
    row <- as.list(row_df)
    src_path <- row$datapath
    if(is.na(src_path) || !nzchar(src_path) || !file.exists(src_path)) {
      return(row_df)
    }
    dst_path <- file.path(root_dir, row$relativePath, fsep = "/")
    dir.create(dirname(dst_path), showWarnings = FALSE, recursive = TRUE)
    file.rename(from = src_path, to = dst_path)
    row$datapath <- dst_path
    as.data.frame(row)
  })
  do.call("rbind", res)
}

file_ext <- function(file) {
  file_lower <- tolower(file)
  is_gz <- endsWith(file_lower, ".gz")
  if(is_gz) {
    file_lower <- gsub("\\.gz$", "", file_lower)
    ext2 <- ".gz"
  } else {
    ext2 <- ""
  }
  
  file_lower <- basename(file_lower)
  
  s <- strsplit(file_lower, "\\.")[[1]]
  if(length(s) == 1) {
    return(ext2)
  }
  return(sprintf(".%s%s", s[[length(s)]], ext2))
}

bslib_theme <- function() {
  theme <- bslib::bs_theme('5', preset = "zephyr")
  theme <- bslib::bs_add_rules(
    theme,
    c(
      ".main.bslib-gap-spacing { padding: 0 !important; }",
      ".shiny-output-error-validation { padding: 10px; }",
      ".navbar-header .navbar-brand a { text-decoration: none; }"
    )
  )
  theme
}

request_asset <- function(asset_name) {
  # asset_name <- "freesurfer-models/cvs_avg35_inMNI152_manifest.json"
  
  dst_path <- file.path(work_path, "../../assets/app-data/", asset_name, fsep = "/")
  dst_path <- fs::path_norm(dst_path)
  
  if(!file.exists(dst_path)) {
    # request: download
    src_path <- file.path(gsub("[/]+$", "", build_info$base_url), "app-data", asset_name, fsep = "/")
    if(endsWith(src_path, "manifest.json")) {
      dst_path <- src_path
    } else {
      dir.create(dirname(dst_path), showWarnings = FALSE, recursive = TRUE)
      utils::download.file(url = src_path, destfile = dst_path)
    }
  }
  dst_path
}

# R-based lazy asset loader for WASM environment
# Downloads brain model files and loads them into threeBrain
load_shared_assets <- function(manifest_name, callback = NULL) {
  # manifest_name <- "freesurfer-models/cvs_avg35_inMNI152_manifest.json"
  manifest_path <- request_asset(manifest_name)
  
  manifest_info <- dipsaus::read_json(manifest_path)
  
  asset_prefix <- gsub("[/]+$", "", manifest_info$path)
  
  n_files <- length(manifest_info$files)
  
  callback_ <- function(...) {
    if(is.function(callback)) {
      callback(...)
    }
    return()
  }
  
  # Create progress
  promises::then(
    
    promises::promise(function(resolve, reject) {
      tryCatch(
        {
          progress <- dipsaus::progress2(
            title = sprintf("Loading %s", manifest_info$name),
            max = n_files,
            shiny_auto_close = TRUE
          )
          
          res <- lapply(seq_len(n_files), function(ii) {
            file_info <- manifest_info$files[[ii]]
            progress$inc(file_info$path)
            asset_name <- file.path(asset_prefix, file_info$path)
            request_asset(asset_name)
          })
          
          resolve(unlist(res))
        },
        error = function(e) {
          reject(e)
        }
      )
    }),
    
    onFulfilled = callback_, onRejected = callback_
  )
}

bslib_page_template <- function(..., sidebar, fluid = TRUE, window_title = module_title) {
  if(!length(module_id)) {
    module_id <- "home"
  }
  if(module_id == "home") {
    bslib::page_navbar(
      title = shiny::a("RAVE Portable Widgets", target = "_blank", href = "https://rave.wiki"), 
      fillable = TRUE,
      fillable_mobile = FALSE,
      theme = bslib_theme(),
      window_title = window_title,
      fluid = fluid, 
      selected = module_id,
      navbar_options = bslib::navbar_options(class = "py-1"),
      sidebar = sidebar,
      bslib::nav_panel(
        title = "Home", value = "home",
        ...
      )
    )
  } else {
    bslib::page_navbar(
      title = shiny::a("RAVE Portable Widgets", target = "_blank", href = "https://rave.wiki"), 
      fillable = TRUE,
      fillable_mobile = FALSE,
      theme = bslib_theme(),
      window_title = window_title,
      fluid = fluid, 
      selected = module_id,
      navbar_options = bslib::navbar_options(class = "py-1"),
      sidebar = sidebar,
      bslib::nav_item(
        shiny::a("Home", href = "../../", target = "_blank"),
        dipsaus::use_shiny_dipsaus()
      ),
      bslib::nav_panel(
        title = module_title,
        value = module_id,
        # class = "",
        ...
      ),
      bslib::nav_item(
        shiny::actionLink(inputId = ns("_description_"), label = "Module Information")
      )
    )
  }
}

server_common <- function(input, output, session) {
  shiny::bindEvent(
    safe_observe({
      
      description_ui <- shiny::tagList(
        shiny::div(
          shiny::HTML(module_description)
        ),
        shiny::h5("Citation"),
        shiny::HTML(format(CITATION, style = "html"))
      )
      shiny::showModal(
        session = session,
        shiny::modalDialog(
          title = sprintf("Module: %s", paste(module_title, collapse = " ")),
          shiny::fluidRow(shiny::column(width = 12L, description_ui)),
          size = "l",
          easyClose = TRUE,
          footer = shiny::modalButton("Close")
        )
      )
    }),
    input[['_description_']],
    ignoreNULL = TRUE, ignoreInit = TRUE
  )
}

# WASM download helpers for shinylive environments
## WASM download helpers were removed in favor of `dipsaus::stream_download()`.
##
## - Use `shiny::actionButton()` (or any button) in UI for triggering downloads.
## - In server, call `dipsaus::stream_download(session, filepath, filename, cleanup = TRUE)`
##
## The old helpers `wasm_download_button()` and `wasm_send_file_download()` were removed
## to avoid duplication; use the `dipsaus` package directly instead.


start_app <- function(ui, server, launch.browser = TRUE, ...) {
  shiny::shinyApp(ui = ui, server = function(input, output, session) {
    shiny::moduleServer(id = module_id, module = function(input, output, session) {
      server_common(input, output, session)
      server(input, output, session)
    }, session = session)
  }, options = list(launch.browser = launch.browser, ...))
}
