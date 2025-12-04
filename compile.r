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

use_cache <- TRUE

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
    fs::link_create(shared_path, fs::path_abs(share_link), symbolic = TRUE)
  }
  # get app title
  app_title <- NULL
  meta_file <- file.path("./apps", app_name, "manifest.yaml")
  if(file.exists(meta_file)) {
    meta_info <- yaml::read_yaml(meta_file)
    app_title <- meta_info$app_title
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
  
  data.frame(
    id = app_name,
    title = app_title
  )
})

app_table <- do.call("rbind", apps)

ul_html <- shiny::tags$ul(lapply(apps, function(item) {
  shiny::tags$li(shiny::a(
    item$title,
    href = sprintf("%s/index.html", item$id)
    # target = "_blank"
  ))
}))

# save index.html
source("www/r/shiny-helper.r")
index_html <- bslib_page_template(
  "home",
  "RAVE (portable version)",
  sidebar = NULL,
  window_title = "RAVE (portable version)",
  fluid = FALSE,
  ul_html
)

htmltools::save_html(index_html, "site/index.html")


# copy the static folders
assets <- list.files(
  "assets",
  all.files = FALSE,
  full.names = FALSE,
  recursive = TRUE,
  include.dirs = FALSE
)
lapply(assets, function(f) {
  src <- file.path("assets", f)
  dst <- file.path("site", f)
  dir.create(dirname(dst), showWarnings = FALSE, recursive = TRUE)
  file.copy(from = src, to = dst, overwrite = FALSE, recursive = FALSE)
})
# httpuv::runStaticServer("site")
