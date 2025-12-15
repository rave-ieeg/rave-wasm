library(shiny)
library(knitr)

ui <- fluidPage(
  # Load the integration script (adjust path if your app is in a subfolder)
  tags$head(
    tags$script(type = "module", src = "../../pandoc/pandoc-integration.js"),
    tags$script("
      $(document).on('click', '#download_btn_js', function() {
        const content = document.getElementById('pandoc_output').innerHTML;
        if(!content) { alert('No content to download'); return; }
        const blob = new Blob(['<!DOCTYPE html><html><head><title>Report</title></head><body>' + content + '</body></html>'], {type: 'text/html'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'report.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    ")
  ),
  
  titlePanel("Pandoc Wasm Demo"),
  
  sidebarLayout(
    sidebarPanel(
      textAreaInput("rmd_input", "RMarkdown", height = "300px", value = paste(
        "## Hello WASM",
        "",
        "This is **bold** text.",
        "",
        "```{r}",
        "summary(cars)",
        "plot(cars)",
        "```",
        sep = "\n"
      )),
      actionButton("convert_btn", "Convert to HTML"),
      actionButton("download_btn_js", "Download HTML", icon = icon("download"))
    ),
    mainPanel(
      # Container for the output
      div(id = "pandoc_output", style = "border: 1px solid #ddd; padding: 15px; min-height: 200px;")
    )
  )
)

server <- function(input, output, session) {
  observeEvent(input$convert_btn, {
    req(input$rmd_input)
    
    # Knit first
    markdown <- tryCatch({
      # Configure knitr to encode images as data URIs
      knitr::opts_knit$set(upload.fun = knitr::image_uri)
      knitr::knit(text = input$rmd_input, quiet = TRUE)
    }, error = function(e) {
      paste("Error knitting:", e$message)
    })
    
    # Send to JS for display
    session$sendCustomMessage("rave_pandoc_convert", list(
      markdown = markdown,
      outputId = "pandoc_output"
    ))
  })
}

shinyApp(ui, server)
