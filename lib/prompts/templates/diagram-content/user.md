Create an interactive diagram for: {{title}}

## Diagram Type
{{diagramType}}

## Description
{{description}}

## Key Points
{{keyPoints}}

## Language
{{languageDirective}}

---

Generate a complete HTML diagram with:

1. **SVG nodes** with icons, labels, and click-to-show details
2. **Edges with arrows** connecting nodes (calculate endpoints from node dimensions)
3. **Step-by-step reveal** (Next/Previous)
4. **High contrast**: White nodes on dark background, light edge labels
5. **Mobile-friendly**: Collapsible sidebar, doesn't block diagram
6. **First node visible** on load

ALL UI text — button labels (Next/Previous/Reset), captions, tooltips, node labels, and any inline widget text — MUST be in the course language ({{languageDirective}}). Never emit another language for UI chrome.

Embed config in `<script type="application/json" id="widget-config">`.