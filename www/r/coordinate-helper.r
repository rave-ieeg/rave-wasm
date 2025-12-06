parse_electrode_coordinate <- function(path, filename = basename(path)) {
  re <- list(
    table = NULL,
    coord_sys = NULL
  )
  csv_path <- path
  if(file_ext(csv_path) == ".tsv") {
    # BIDS
    coord_table <- read.table(csv_path, header = TRUE, sep = "\t", na.strings = "n/a")
  } else {
    # native?
    coord_table <- read.csv(csv_path)
  }
  nr <- nrow(coord_table)
  if(!nr) {
    return(re)
  }
  if(!length(coord_table$Electrode)) {
    coord_table$Electrode <- coord_table$Channel %||% coord_table$channel %||% seq_len(nr)
  }
  if(!length(coord_table$Label)) {
    coord_table$Label <- coord_table$name %||% coord_table$label %||% sprintf("Unknown%04d", seq_len(nr))
  }
  re$table <- coord_table
  nms <- names(coord_table)
  if(all(c("Coord_x", "Coord_y", "Coord_z") %in% nms)) {
    re$tkrRAS <- coord_table[, c("Coord_x", "Coord_y", "Coord_z")]
    re$coord_sys <- c(re$coord_sys, "tkrRAS")
  }
  if(all(c("T1R", "T1A", "T1S") %in% nms)) {
    re$scannerRAS <- coord_table[, c("T1R", "T1A", "T1S")]
    re$coord_sys <- c(re$coord_sys, "scannerRAS")
  } 
  if(all(c("MNI305_x", "MNI305_y", "MNI305_z") %in% nms)) {
    re$MNI305 <- coord_table[, c("MNI305_x", "MNI305_y", "MNI305_z")]
    re$coord_sys <- c(re$coord_sys, "MNI305")
  } 
  if(all(c("MNI152_x", "MNI152_y", "MNI152_z") %in% nms)) {
    re$MNI152 <- coord_table[, c("MNI152_x", "MNI152_y", "MNI152_z")]
    re$coord_sys <- c(re$coord_sys, "MNI152")
  } 
  if(all(c("x", "y", "z") %in% nms)) {
    # try to infer from the filename
    bids_parsed <- bidsr::parse_path_bids_entity(filename)
    coord_sys <- paste(bids_parsed$entities$space$value, collapse = "")
    coord_sys <- switch (
      substr(toupper(coord_sys), 1, 6),
      "MNI305" = "MNI305",
      "FSAVER" = "MNI305",
      "MNI152" = "MNI152",
      "FREESU" = "tkrRAS",
      "scannerRAS"
    )
    if(!coord_sys %in% re$coord_sys) {
      re[[coord_sys]] <- coord_table[, c("x", "y", "z")]
      re$coord_sys <- c(re$coord_sys, coord_sys)
    }
  }
  return(re)
}
