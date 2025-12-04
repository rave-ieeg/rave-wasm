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
      ".shiny-output-error-validation { padding: 10px; }"
    )
  )
  theme
}

bslib_page_template <- function(module_id, module_title, sidebar, 
                                window_title = module_title, fluid = TRUE, ...) {
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
        shiny::a("Home", href = "/")
      ),
      bslib::nav_panel(
        title = module_title,
        value = module_id,
        # class = "",
        ...
      )
    )
  }
}

# WASM download helpers for shinylive environments
wasm_download_button <- function(inputId, label, ..., style = NULL) {
  # Create action button styled like download button
  btn <- shiny::actionButton(
    inputId = inputId,
    label = label,
    class = "btn-primary",
    style = style,
    ...
  )
  
  # JavaScript handler for chunked download
  js_code <- shiny::tags$script(shiny::HTML(sprintf("
    (function() {
      if (!window._wasmDownloadHandlerInitialized) {
        window._wasmDownloadHandlerInitialized = true;
        window._wasmDownloadChunks = {};
        
        Shiny.addCustomMessageHandler('wasmDownloadChunk', function(message) {
          try {
            const downloadId = message.filename || 'download';
            
            // Initialize chunks array for this download
            if (message.chunk_index === 1) {
              window._wasmDownloadChunks[downloadId] = [];
            }
            
            // Decode base64 chunk to Uint8Array
            const binaryString = atob(message.chunk);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Accumulate chunk
            window._wasmDownloadChunks[downloadId].push(bytes);
            
            // When complete, create blob and trigger download
            if (message.is_complete === true) {
              const chunks = window._wasmDownloadChunks[downloadId];
              
              // Create blob directly from chunks array (more memory efficient for large files)
              const blob = new Blob(chunks, { type: 'application/octet-stream' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = message.filename || 'download.html';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              
              // Cleanup
              setTimeout(() => URL.revokeObjectURL(url), 100);
              delete window._wasmDownloadChunks[downloadId];
            }
          } catch (e) {
            console.error('WASM download error:', e);
            if (Shiny && Shiny.notifications) {
              Shiny.notifications.show({
                html: 'Download failed: ' + e.message,
                type: 'error'
              });
            }
          }
        });
      }
    })();
  ")))
  
  shiny::tagList(btn, js_code)
}

wasm_send_file_download <- function(session, filepath, filename, 
                                     chunk_size = 2 * 1024^2, cleanup = TRUE) {
  # Validate file exists
  if (!file.exists(filepath)) {
    stop("File not found: ", filepath)
  }
  
  # Get file info
  finfo <- file.info(filepath)
  filesize <- finfo$size
  
  if (filesize == 0) {
    shiny::showNotification("File is empty, cannot download", type = "error")
    return(invisible(NULL))
  }
  
  # Calculate total chunks
  total_chunks <- ceiling(filesize / chunk_size)
  
  # Open binary connection
  con <- file(filepath, "rb")
  on.exit({
    close(con)
    if (cleanup && file.exists(filepath)) {
      unlink(filepath)
    }
  })
  
  # Read and send chunks
  tryCatch({
    # Initialize progress
    progress <- dipsaus::progress2(sprintf("Exporting %s", filename), max = total_chunks, shiny_auto_close = TRUE)
    
    for (i in seq_len(total_chunks)) {
      # Read chunk
      raw_chunk <- readBin(con, "raw", n = chunk_size)
      
      if (length(raw_chunk) == 0) {
        break
      }
      
      # Base64 encode
      base64_chunk <- jsonlite::base64_enc(raw_chunk)
      
      # Send to client
      session$sendCustomMessage(
        type = 'wasmDownloadChunk',
        message = list(
          chunk = base64_chunk,
          chunk_index = i,
          total_chunks = total_chunks,
          filename = filename,
          filesize = filesize,
          is_complete = FALSE
        )
      )
      
      # Update progress
      progress_message <- sprintf("Chunk %d/%d", i, total_chunks)
      progress$inc(progress_message)
      
      # Small delay to prevent overwhelming the message queue
      Sys.sleep(0.001)
    }
    
    # Send completion message
    session$sendCustomMessage(
      type = 'wasmDownloadChunk',
      message = list(
        chunk = "",
        chunk_index = total_chunks,
        total_chunks = total_chunks,
        filename = filename,
        filesize = filesize,
        is_complete = TRUE
      )
    )
    
  }, error = function(e) {
    shiny::showNotification(
      paste("Download failed:", e$message),
      type = "error",
      duration = NULL
    )
    stop(e)
  })
  
  invisible(NULL)
}
