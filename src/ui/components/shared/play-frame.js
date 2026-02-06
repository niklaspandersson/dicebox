/**
 * PlayFrame - Reusable decorative frame component
 * Provides the red/navy bordered frame with gold corner decorations
 */
class PlayFrame extends HTMLElement {
  connectedCallback() {
    // Move existing children to a fragment
    const fragment = document.createDocumentFragment();
    while (this.firstChild) {
      fragment.appendChild(this.firstChild);
    }

    // Create the frame structure
    const outer = document.createElement("div");
    outer.className = "play-frame-outer";
    outer.innerHTML = `
      <div class="play-frame-inner">
        <div class="play-frame-top-slot"></div>
        <span class="play-corner corner-tl"></span>
        <span class="play-corner corner-tr"></span>
        <span class="play-corner corner-bl"></span>
        <span class="play-corner corner-br"></span>
        <div class="play-frame-content"></div>
      </div>
    `;

    // Append original children to content area
    outer.querySelector(".play-frame-content").appendChild(fragment);
    this.appendChild(outer);
  }
}

customElements.define("play-frame", PlayFrame);
