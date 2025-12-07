#' Compile the apps into `WASM` modules
#' @author Zhengjia Wang
#' @date Dec 01, 2025
#' @details
#' The script will remove existing `site/` folder and rebuild the entire 
#' application folder from `apps`.
#' 
#' Please make sure you install the latest `shinylive` package. This can be 
#' achieved via `pak::pak("posit-dev/r-shinylive")`. This is because the 
#' `shinylive` CRAN release might be outdated.
NULL

debug <- TRUE

if(debug && dipsaus::rs_avail() && !is.na(dipsaus::rs_active_project())) {
  setwd(dipsaus::rs_active_project())
}

use_cache <- identical(Sys.getenv("RAVE_WASM_CACHE", unset = ifelse(debug, "TRUE", "FALSE")), "TRUE")
base_url <- Sys.getenv("RAVE_WASM_BASE_URL", unset = ifelse(debug, "http://127.0.0.1:8000", "https://rave.wiki/rave-wasm"))

# ---- Step 1: download shinylive assets ---------------------------------------
# Make sure the version is the latest to be in consistent with the latest R version
# pak::pak("posit-dev/r-shinylive")
shinylive_asset_version <- shinylive::assets_version()
shinylive::assets_ensure(version = shinylive_asset_version)
shinylive::assets_info(quiet = FALSE)

# set up repository
repos <- as.list(getOption("repos"))
repos[['rave-ieeg']] <- "https://rave-ieeg.r-universe.dev"
repos <- repos[unique(c("rave-ieeg", names(repos)))]
options(repos = unlist(repos, use.names = TRUE))

# ---- Step 2: build site manifest ---------------------------------------------
jsonlite::write_json(
  path = "www/build-manifest.json",
  list(
    build_timestamp = format(Sys.time(), format = "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    base_url = base_url,
    shinylive_asset_version = shinylive_asset_version
  )
)

# ---- Step 3: build site/ -----------------------------------------------------
# Remove site folder to avoid old files
if(!use_cache) {
  unlink("site/", recursive = TRUE)
}

# Find all the apps
app_names <- list.dirs("apps", full.names = FALSE, recursive = FALSE)
app_names <- app_names[!startsWith(app_names, ".")]
app_names <- app_names[!app_names %in% c("shinylive", "shinylive-sw")]

shared_path <- fs::path_abs("./www")
apps <- lapply(app_names, function(app_name) {
  share_link <- file.path("./apps", app_name, "www")
  has_link <- fs::link_exists(share_link)
  if(has_link && !fs::path_rel(shared_path, start = fs::link_path(share_link)) != ".") {
    has_link <- FALSE
  }
  if(!has_link) {
    if(file.exists(share_link)) {
      unlink(share_link, recursive = TRUE)
    }
    
    fs::link_create(shared_path, 
                    normalizePath(share_link, winslash = "/", mustWork = FALSE),
                    symbolic = TRUE)
  }
  # get app title, preload_packages, and preload_assets from manifest
  app_title <- NULL
  preload_packages <- NULL
  preload_assets <- NULL
  meta_file <- file.path("./apps", app_name, "manifest.yaml")
  if(file.exists(meta_file)) {
    meta_info <- yaml::read_yaml(meta_file)
    app_title <- meta_info$app_title
    preload_packages <- meta_info$preload_packages
    preload_assets <- meta_info$preload_assets
  }
  if(!length(app_title)) {
    app_title <- strsplit(app_name, "-", fixed = TRUE)[[1]]
    substr(app_title, start = 1, stop = 1) <- toupper(substr(app_title, start = 1, stop = 1))
  }
  app_title <- paste(app_title, collapse = " ")
  
  shinylive::export(
    template_params = list(
      title = app_title
    ),
    appdir = file.path("apps", app_name),
    destdir = "site",
    subdir = app_name,
    package_cache = TRUE,
    assets_version = shinylive_asset_version
  )
  # Ensure service worker path works when the app is hosted in a sub-path.
  # Insert the meta tag right after the first <head> tag in the generated index.html
  index_path <- file.path("site", app_name, "index.html")
  if (file.exists(index_path)) {
    html_lines <- readLines(index_path, warn = FALSE)
    html_text <- paste(html_lines, collapse = "\n")
    meta_tag <- '<meta name="shinylive:serviceworker_dir" content="../">'
    # Insert meta tag after the opening <head> tag (handles attributes if any)
    new_html_text <- sub("(<head[^>]*>)", paste0("\\1\n  ", meta_tag), html_text, perl = TRUE)
    if (!identical(new_html_text, html_text)) {
      writeLines(strsplit(new_html_text, "\n")[[1]], index_path)
    }
  }
  
  list(
    id = app_name,
    title = app_title,
    preload_packages = preload_packages,
    preload_assets = preload_assets
  )
})

# ---- Step 3b: Generate package preload manifests -----------------------------
# Read package metadata from shinylive
metadata_path <- "site/shinylive/webr/packages/metadata.rds"
if (file.exists(metadata_path)) {
  pkg_metadata <- readRDS(metadata_path)
  
  # Build package path lookup: package_name -> relative path (e.g., "packages/utf8/utf8_1.2.6.tgz")
  all_pkg_paths <- vapply(pkg_metadata, function(pkg) {
    if (!is.null(pkg$path)) {
      return(pkg$path)
    }
    return(NA_character_)
  }, character(1), USE.NAMES = TRUE)
  all_pkg_paths <- all_pkg_paths[!is.na(all_pkg_paths)]
  
  # Compute cache version from all package paths (hash of sorted paths)
  cache_version <- dipsaus::digest(sort(all_pkg_paths))
  
  # Generate preload manifest for each app
  for (app_info in apps) {
    app_name <- app_info$id
    preload_packages <- app_info$preload_packages
    preload_assets <- app_info$preload_assets
    
    # Determine which packages to preload
    if (is.null(preload_packages)) {
      # NULL means preload all packages
      pkg_paths_to_preload <- as.list(all_pkg_paths)
    } else if (length(preload_packages) == 0) {
      # Empty list means disable preloading
      pkg_paths_to_preload <- list()
    } else {
      # Specific packages listed
      pkg_paths_to_preload <- as.list(all_pkg_paths[preload_packages])
      pkg_paths_to_preload <- pkg_paths_to_preload[!is.na(pkg_paths_to_preload)]
    }
    
    # Resolve preload_assets: expand directories to file lists
    # Note: We look in assets/ folder since site/ is populated later in Step 6
    asset_paths_to_preload <- list()
    if (length(preload_assets) > 0) {
      for (asset_path in preload_assets) {
        full_path <- file.path("assets", asset_path)
        if (dir.exists(full_path)) {
          # It's a directory - list all files recursively
          files <- list.files(full_path, recursive = TRUE, full.names = FALSE)
          # Prepend the asset_path (ensure no trailing slash for joining)
          asset_dir <- sub("/$", "", asset_path)
          asset_paths_to_preload <- c(asset_paths_to_preload, as.list(file.path(asset_dir, files)))
        } else if (file.exists(full_path)) {
          # It's a single file
          asset_paths_to_preload <- c(asset_paths_to_preload, list(asset_path))
        } else {
          warning(sprintf("  Asset not found: %s", asset_path))
        }
      }
    }
    
    # Create preload manifest
    preload_manifest <- list(
      cache_version = cache_version,
      packages = unname(pkg_paths_to_preload),
      assets = unname(asset_paths_to_preload)
    )
    
    # Write to app directory
    manifest_path <- file.path("site", app_name, "preload-manifest.json")
    jsonlite::write_json(preload_manifest, manifest_path, auto_unbox = TRUE, pretty = TRUE)
    message(sprintf("  Generated preload manifest for %s: %d packages, %d assets", 
                    app_name, length(pkg_paths_to_preload), length(asset_paths_to_preload)))
  }
  
  # Also write a global preload manifest with all packages (for service worker)
  global_manifest <- list(
    cache_version = cache_version,
    packages = unname(as.list(all_pkg_paths))
  )
  jsonlite::write_json(global_manifest, "site/shinylive/preload-manifest.json", auto_unbox = TRUE, pretty = TRUE)
  message(sprintf("  Generated global preload manifest: %d packages", length(all_pkg_paths)))
} else {
  warning("metadata.rds not found - skipping preload manifest generation")
  cache_version <- "v1"
}

app_table <- do.call("rbind", lapply(apps, function(item) {
  data.frame(id = item$id, title = item$title)
}))
ul_html <- shiny::tags$ul(lapply(apps, function(item) {
  shiny::tags$li(shiny::a(
    item$title,
    href = sprintf("%s/index.html", item$id)
    # target = "_blank"
  ))
}))

# Inject: modify shinylive.js
shinylive_js <- readLines('./site/shinylive/shinylive.js')

# Injection 1: URL params injection (existing)
anchor_text <- 'runApp(appRoot, appMode, { startFiles: appFiles }, appEngine);'
inject_text <- 'const urlObj={}; urlParams.forEach((k, v) => {urlObj[k] = v;}); appFiles.push({"name" : ".urlParams", "content" : JSON.stringify(urlObj) });'

inject_index <- which(trimws(shinylive_js) == anchor_text)
if(length(inject_index) > 0 && trimws(shinylive_js[inject_index-1]) != inject_text) {
  shinylive_js[inject_index] <- paste(collapse = "\n", c(
    inject_text, anchor_text
  ))
}

# Injection 2: Package and asset prefetch at the start of runExportedApp
# This runs prefetch in parallel while app.json is being fetched
prefetch_code <- '
// Prefetch packages and assets to warm browser cache (injected by compile.r)
const _prefetchPackages = (async () => {
  try {
    const appPath = window.location.pathname.replace(/\\/[^\\/]*$/, "");
    const manifestUrl = appPath + "/preload-manifest.json";
    const resp = await fetch(manifestUrl);
    if (resp.ok) {
      const manifest = await resp.json();
      const siteBasePath = appPath.replace(/\\/[^\\/]+$/, "") + "/";
      const webrBasePath = siteBasePath + "shinylive/webr/";
      
      // Prefetch packages
      const pkgPromises = (manifest.packages || []).map(pkg => 
        fetch(webrBasePath + pkg).catch(() => {})
      );
      
      // Prefetch assets (paths relative to site/)
      const assetPromises = (manifest.assets || []).map(asset => 
        fetch(siteBasePath + asset).catch(() => {})
      );
      
      await Promise.all([...pkgPromises, ...assetPromises]);
      console.log("[shinylive] Prefetched " + (manifest.packages || []).length + " packages, " + (manifest.assets || []).length + " assets");
    }
  } catch (e) {
    console.warn("[shinylive] Package/asset prefetch failed:", e);
  }
})();
async function runExportedApp({'

# Find and replace the function definition
old_func <- 'async function runExportedApp({'
# Check if ANY prefetch code was already injected (old or new version)
if(!any(grepl("_prefetchPackages = \\(async", shinylive_js, perl = TRUE))) {
  shinylive_js <- gsub(old_func, prefetch_code, shinylive_js, fixed = TRUE)
}

writeLines(shinylive_js, './site/shinylive/shinylive.js', sep = "\n")

# ---- Step 3c: Modify shinylive-sw.js for package caching ---------------------
sw_js_path <- './site/shinylive-sw.js'
sw_js <- readLines(sw_js_path)

# Replace version with dynamic cache version based on package content
sw_js <- gsub(
  'var version = "v10";',
  sprintf('var version = "%s";', cache_version),
  sw_js, fixed = TRUE
)

# Create web version with caching enabled (for static web hosting)
sw_js_web <- gsub('var useCaching = false;', 'var useCaching = true;', sw_js, fixed = TRUE)
writeLines(sw_js_web, sw_js_path, sep = "\n")
message("  Modified shinylive-sw.js: enabled caching with version ", cache_version)

# Create Electron version with caching disabled (Electron uses variable ports)
sw_js_electron <- sw_js  # Keep useCaching = false
writeLines(sw_js_electron, './site/shinylive-sw-electron.js', sep = "\n")
message("  Created shinylive-sw-electron.js: caching disabled for Electron")

# ---- Step 4: build root index.html -------------------------------------------
source("www/r/shiny-helper.r")
index_html <- bslib_page_template(
  sidebar = NULL,
  window_title = "RAVE (portable version)",
  fluid = TRUE,
  shiny::div(
    style = "min-height: 15px"
  ),
  shiny::div(
    class = "jumbotron",
    shiny::div(
      class = "container",
      shiny::p(
        # class = "lead",
        "A collection of server-less RAVE widgets that runs entirely in your local browser. ",
        "All the listed modules below are offline and your data will not be uploaded to the internet. ",
        "The modules might take a while to load so please be patient. ",
        shiny::a("Click here", href = "https://github.com/rave-ieeg/rave-wasm/releases", target = "_blank"),
        "to download the offline app."
      )
    )
  ),
  shiny::hr(),
  shiny::div(
    class = "container",
    shiny::fluidRow(
      shiny::column(
        width = 12L,
        ul_html
      )
    )
  )
)

htmltools::save_html(index_html, "site/index.html")


# ---- Step 5: Generate manifests ----------------------------------------------
# Generate manifests for FreeSurfer brain models
freesurfer_models_dir <- "assets/app-data/freesurfer-models"
if (dir.exists(freesurfer_models_dir)) {
  model_dirs <- list.dirs(freesurfer_models_dir, full.names = FALSE, recursive = FALSE)
  model_dirs <- model_dirs[!startsWith(model_dirs, ".")]
  
  if (length(model_dirs) > 0) {
    message("Generating brain model manifests...")
    
    # Get version as YYYY.MM.DD
    build_version <- format(Sys.Date(), "%Y.%m.%d")
    
    for (model_name in model_dirs) {
      model_path <- file.path(freesurfer_models_dir, model_name)
      
      # Get all files recursively
      all_files <- list.files(
        model_path,
        all.files = FALSE,
        full.names = TRUE,
        recursive = TRUE,
        include.dirs = FALSE
      )
      
      if (length(all_files) == 0) {
        message(sprintf("  Skipping %s (no files found)", model_name))
        next
      }
      
      # Build file list with relative paths and sizes
      file_list <- lapply(all_files, function(file_path) {
        rel_path <- sub(paste0("^", model_path, "/"), "", file_path)
        file_info <- file.info(file_path)
        list(
          path = rel_path,
          size = as.integer(file_info$size),
          digest = dipsaus::digest(file_path)
        )
      })
      
      # Create manifest
      manifest <- list(
        name = model_name,
        path = sprintf("freesurfer-models/%s", model_name),
        version = build_version,
        cache_key = paste0("rave-", model_name, "-v", build_version),
        files = file_list
      )
      
      manifest_digest <- dipsaus::digest(manifest)
      manifest$digest <- manifest_digest
      
      
      # check existing manifest
      manifest_filename <- paste0(model_name, "_manifest.json")
      manifest_path <- file.path("assets/app-data/freesurfer-models", manifest_filename)
      if(file.exists(manifest_path)) {
        try({
          existing_manifest <- dipsaus::read_json(manifest_path)
          if(identical(existing_manifest$digest, manifest_digest)) {
            message(sprintf("  Skipping %s (unchanged)", model_name))
            next
          }
        })
      }
      
      # Write manifest to assets directory
      dir.create(dirname(manifest_path), showWarnings = FALSE, recursive = TRUE)
      writeLines(
        jsonlite::toJSON(manifest, auto_unbox = TRUE, pretty = TRUE),
        manifest_path
      )
      
      total_size <- sum(sapply(file_list, function(x) x$size))
      message(sprintf("  Generated %s: %d files, %.2f MB", 
                      manifest_filename, 
                      length(file_list), 
                      total_size / (1024^2)))
    }
  }
}


# ---- Step 6: include static assets -------------------------------------------
# copy the static folders (include hidden files like .nojekyll)
assets <- list.files(
  "assets",
  all.files = TRUE,
  full.names = FALSE,
  recursive = TRUE,
  include.dirs = FALSE
)
assets <- assets[!assets %in% c(".", "..")]
lapply(assets, function(f) {
  src <- file.path("assets", f)
  dst <- file.path("site", f)
  dir.create(dirname(dst), showWarnings = FALSE, recursive = TRUE)
  file.copy(from = src, to = dst, overwrite = TRUE, recursive = FALSE)
}) |> invisible()

# ---- Step 7: Preview ---------------------------------------------------------
if(debug && interactive() && rstudioapi::isAvailable()) {
  httpuv::stopAllServers()
  httpuv::runStaticServer("site", background = TRUE, port = 8000)
}

