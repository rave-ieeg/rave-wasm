#' Estimate Electron App Bundle Size
#' @author Zhengjia Wang
#' @date Dec 06, 2025
#' @details
#' This script estimates the size of the Electron app bundle by analyzing
#' the files that would be included based on package.json build configuration.
#' It also includes Electron runtime overhead estimates per platform.
NULL

# ---- Configuration -----------------------------------------------------------

# Electron runtime overhead estimates (in bytes)
# These are approximate sizes for Electron v35+ based on typical bundle sizes
electron_overhead <- list(

  mac_arm64 = 180 * 1024^2,   # ~180 MB for macOS ARM64

  mac_x64   = 190 * 1024^2,   # ~190 MB for macOS x64
  win_x64   = 160 * 1024^2,   # ~160 MB for Windows x64

  win_ia32  = 140 * 1024^2,   # ~140 MB for Windows 32-bit
  linux_x64 = 170 * 1024^2,   # ~170 MB for Linux x64
  linux_arm64 = 165 * 1024^2  # ~165 MB for Linux ARM64
)

# Files/patterns from package.json build.files
# "main.js", "preload.js", "src/**/*", "site/**/*", "assets/**/*"
# Excludes: "!assets/app-data/**/*"
# Note: site/app-data/ should also be excluded for Electron builds

# ---- Helper Functions --------------------------------------------------------

#' Format bytes to human-readable size
format_size <- function(bytes, digits = 2) {
  units <- c("B", "KB", "MB", "GB", "TB")
  unit_idx <- 1
  size <- bytes
  while (size >= 1024 && unit_idx < length(units)) {
    size <- size / 1024
    unit_idx <- unit_idx + 1
  }

  sprintf("%.*f %s", digits, size, units[unit_idx])
}

#' Get total size of files in a directory (optionally filtered)
get_dir_size <- function(dir_path, exclude_pattern = NULL, recursive = TRUE) {
  if (!dir.exists(dir_path)) {
    return(list(size = 0, count = 0, files = character(0)))
  }
  
  files <- list.files(dir_path, all.files = TRUE, full.names = TRUE, 
                      recursive = recursive, include.dirs = FALSE)
  files <- files[!basename(files) %in% c(".", "..")]
  
  # Apply exclusion pattern if provided

if (!is.null(exclude_pattern)) {
    files <- files[!grepl(exclude_pattern, files, perl = TRUE)]
  }
  
  # Get file sizes
  sizes <- file.info(files)$size
  sizes[is.na(sizes)] <- 0
  
  list(
    size = sum(sizes),
    count = length(files),
    files = files
  )
}

#' Get size of a single file
get_file_size <- function(file_path) {
  if (!file.exists(file_path)) {
    return(0)
  }
  file.info(file_path)$size
}

# ---- Main Analysis -----------------------------------------------------------

estimate_electron_size <- function(project_dir = ".") {
  
  old_wd <- getwd()
  on.exit(setwd(old_wd))
  setwd(project_dir)
  
  cat("=" |> rep(60) |> paste(collapse = ""), "\n")
  cat("Electron App Size Estimation\n")
  cat("=" |> rep(60) |> paste(collapse = ""), "\n\n")
  
  results <- list()
  
  # 1. Main entry files
  main_js_size <- get_file_size("main.js")
  preload_js_size <- get_file_size("preload.js")
  results$entry_files <- list(
    size = main_js_size + preload_js_size,
    details = list(
      "main.js" = main_js_size,
      "preload.js" = preload_js_size
    )
  )
  
  # 2. src/ directory
  src_info <- get_dir_size("src")
  results$src <- src_info
  
  # 3. site/ directory (the main bulk) - excluding app-data for Electron
  site_info <- get_dir_size("site", exclude_pattern = "app-data/")
  results$site <- site_info
  
  # 3a. Breakdown of site/ subdirectories
  site_breakdown <- list()
  
  # shinylive/webr/packages is usually the largest
  webr_packages_info <- get_dir_size("site/shinylive/webr/packages")
  site_breakdown$webr_packages <- webr_packages_info
  
  # webr core (excluding packages)
  webr_core_info <- get_dir_size("site/shinylive/webr", 
                                  exclude_pattern = "packages/")
  site_breakdown$webr_core <- webr_core_info
  
  # shinylive core (excluding webr)
  shinylive_core_info <- get_dir_size("site/shinylive", 
                                       exclude_pattern = "webr/")
  site_breakdown$shinylive_core <- shinylive_core_info
  
  # lib folder
  lib_info <- get_dir_size("site/lib")
  site_breakdown$lib <- lib_info
  
  # app-data (included in site, but also in assets)
  app_data_site_info <- get_dir_size("site/app-data")
  site_breakdown$app_data <- app_data_site_info
  
  # App folders
  app_folders <- list.dirs("site", full.names = FALSE, recursive = FALSE)
  app_folders <- app_folders[!app_folders %in% c("shinylive", "lib", "app-data", ".")]
  app_folders <- app_folders[!startsWith(app_folders, ".")]
  
  apps_total <- 0
  for (app_name in app_folders) {
    app_info <- get_dir_size(file.path("site", app_name))
    site_breakdown[[paste0("app_", app_name)]] <- app_info
    apps_total <- apps_total + app_info$size
  }
  site_breakdown$apps_total <- list(size = apps_total, count = length(app_folders))
  
  results$site_breakdown <- site_breakdown
  
  # 4. assets/ directory (excluding app-data)
  assets_info <- get_dir_size("assets", exclude_pattern = "app-data/")
  results$assets <- assets_info
  
  # 5. Calculate totals
  app_content_size <- results$entry_files$size + 
                      results$src$size + 
                      results$site$size + 
                      results$assets$size
  
  results$app_content_total <- app_content_size
  
  # ---- Print Results ---------------------------------------------------------
  
  cat("App Content Breakdown:\n")
  cat("-" |> rep(60) |> paste(collapse = ""), "\n")
  
  cat(sprintf("  %-35s %12s\n", "Entry files (main.js, preload.js):", 
              format_size(results$entry_files$size)))
  cat(sprintf("  %-35s %12s (%d files)\n", "src/ directory:", 
              format_size(results$src$size), results$src$count))
  cat(sprintf("  %-35s %12s (%d files)\n", "assets/ (excl. app-data):", 
              format_size(results$assets$size), results$assets$count))
  cat(sprintf("  %-35s %12s (%d files)\n", "site/ directory:", 
              format_size(results$site$size), results$site$count))
  
  cat("\n")
  cat("site/ Directory Breakdown:\n")
  cat("-" |> rep(60) |> paste(collapse = ""), "\n")
  
  sb <- results$site_breakdown
  cat(sprintf("  %-35s %12s (%d files)\n", "shinylive/webr/packages/:", 
              format_size(sb$webr_packages$size), sb$webr_packages$count))
  cat(sprintf("  %-35s %12s (%d files)\n", "shinylive/webr/ (core):", 
              format_size(sb$webr_core$size), sb$webr_core$count))
  cat(sprintf("  %-35s %12s (%d files)\n", "shinylive/ (core):", 
              format_size(sb$shinylive_core$size), sb$shinylive_core$count))
  cat(sprintf("  %-35s %12s (%d files)\n", "lib/ (JS libraries):", 
              format_size(sb$lib$size), sb$lib$count))
  cat(sprintf("  %-35s %12s (%d files)\n", "app-data/:", 
              format_size(sb$app_data$size), sb$app_data$count))
  cat(sprintf("  %-35s %12s (%d apps)\n", "App folders:", 
              format_size(sb$apps_total$size), sb$apps_total$count))
  
  cat("\n")
  cat("=" |> rep(60) |> paste(collapse = ""), "\n")
  cat(sprintf("%-37s %12s\n", "TOTAL APP CONTENT:", 
              format_size(app_content_size)))
  cat("=" |> rep(60) |> paste(collapse = ""), "\n")
  
  cat("\n")
  cat("Estimated Bundle Sizes (with Electron runtime):\n")
  cat("-" |> rep(60) |> paste(collapse = ""), "\n")
  
  bundle_sizes <- list()
  for (platform in names(electron_overhead)) {
    overhead <- electron_overhead[[platform]]
    total <- app_content_size + overhead
    bundle_sizes[[platform]] <- total
    
    platform_name <- switch(platform,
      "mac_arm64" = "macOS ARM64 (Apple Silicon)",
      "mac_x64" = "macOS x64 (Intel)",
      "win_x64" = "Windows x64",
      "win_ia32" = "Windows 32-bit",
      "linux_x64" = "Linux x64",
      "linux_arm64" = "Linux ARM64",
      platform
    )
    
    cat(sprintf("  %-35s %12s\n", paste0(platform_name, ":"), 
                format_size(total)))
  }
  
  results$bundle_sizes <- bundle_sizes
  results$electron_overhead <- electron_overhead
  
  # Find large folders (>50MB)
  cat("\n")
  cat("Large Folders (>50 MB):\n")
  cat("-" |> rep(60) |> paste(collapse = ""), "\n")
  
  # Scan all top-level and second-level directories in site/
  large_folders <- list()
  size_threshold <- 50 * 1024^2  # 50 MB
  
  scan_for_large_folders <- function(base_path, depth = 2) {
    if (!dir.exists(base_path)) return(list())
    
    result <- list()
    subdirs <- list.dirs(base_path, full.names = TRUE, recursive = FALSE)
    
    for (subdir in subdirs) {
      if (basename(subdir) %in% c(".", "..")) next
      
      dir_info <- get_dir_size(subdir)
      rel_path <- sub(paste0("^", project_dir, "/?"), "", subdir)
      
      if (dir_info$size >= size_threshold) {
        # Use subdir relative to current working directory
        display_path <- sub("^\\./", "", subdir)
        result[[display_path]] <- dir_info$size
      }
      
      # Recurse if depth allows
      if (depth > 1) {
        child_results <- scan_for_large_folders(subdir, depth - 1)
        result <- c(result, child_results)
      }
    }
    result
  }
  
  # Scan site/, src/, assets/
  large_folders <- c(
    scan_for_large_folders("site", depth = 3),
    scan_for_large_folders("src", depth = 2),
    scan_for_large_folders("assets", depth = 3)
  )
  
  # Sort by size descending
  if (length(large_folders) > 0) {
    sorted_idx <- order(unlist(large_folders), decreasing = TRUE)
    large_folders <- large_folders[sorted_idx]
    
    for (folder_path in names(large_folders)) {
      folder_size <- large_folders[[folder_path]]
      cat(sprintf("  %-45s %12s\n", paste0(folder_path, "/"), 
                  format_size(folder_size)))
    }
  } else {
    cat("  No folders larger than 50 MB found.\n")
  }
  
  results$large_folders <- large_folders
  
  cat("\n")
  cat("Notes:\n")
  cat("-" |> rep(60) |> paste(collapse = ""), "\n")
  cat("  * Electron overhead is approximate and varies with version\n")
  cat("  * DMG/ZIP/NSIS packaging may add compression overhead\n")
  cat("  * assets/app-data/ is EXCLUDED per package.json config\n")
  cat("  * Actual sizes may vary ±10-20% after compression\n")
  
  cat("\n")
  
  invisible(results)
}

# ---- Run Analysis ------------------------------------------------------------

if (interactive()) {
  # If running interactively in RStudio or R console
  project_root <- if (dipsaus::rs_avail() && !is.na(dipsaus::rs_active_project())) {
    dipsaus::rs_active_project()
  } else {
    "."
  }
  results <- estimate_electron_size(project_root)
} else {
  # If sourced from command line
  results <- estimate_electron_size(".")
}
