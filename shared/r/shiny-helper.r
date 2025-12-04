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
# safe_observe <- shiny::observe

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


bslib_page_template <- function(module_id, module_title, sidebar, 
                                window_title = module_title, fluid = TRUE, ...) {
  if(!length(module_id)) {
    module_id <- "home"
  }
  if(module_id == "home") {
    bslib::page_navbar(
      title = shiny::a("RAVE", target = "_blank", href = "https://rave.wiki"), 
      fillable = TRUE,
      fillable_mobile = FALSE,
      theme = bslib::bs_theme('5', preset = "zephyr"),
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
      title = shiny::a("RAVE", target = "_blank", href = "https://rave.wiki"), 
      fillable = TRUE,
      fillable_mobile = FALSE,
      theme = bslib::bs_theme('5', preset = "zephyr"),
      window_title = window_title,
      fluid = fluid, 
      selected = module_id,
      navbar_options = bslib::navbar_options(class = "py-1"),
      sidebar = sidebar,
      bslib::nav_item(
        shiny::a("Home", href = "/")
      ),
      bslib::nav_panel(
        title = "NIfTI/FreeSurfer Viewer", value = module_id,
        ...
      )
    )
  }
  
}
