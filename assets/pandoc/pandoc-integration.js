
import { pandoc } from "./pandoc-main.js";

window.pandoc = pandoc;

if (window.Shiny) {
  Shiny.addCustomMessageHandler("rave_pandoc_convert", (message) => {
    const { markdown, outputId, args } = message;
    try {
      let cmd = args || "-f markdown -t html --mathjax";
      // Strip "pandoc" from the beginning if present
      cmd = cmd.replace(/^pandoc\s+/, "");
      
      const html = pandoc(cmd, markdown);
      const el = document.getElementById(outputId);
      if (el) {
        el.innerHTML = html;
        // Trigger MathJax if available
        if (window.MathJax && window.MathJax.typesetPromise) {
          window.MathJax.typesetPromise([el]);
        }
      }
    } catch (e) {
      console.error("Pandoc conversion failed:", e);
      const el = document.getElementById(outputId);
      if (el) {
        el.innerHTML = `<div style="color:red">Pandoc Error: ${e.message}</div>`;
      }
    }
  });
}

