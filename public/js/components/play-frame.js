/**
 * PlayFrame - Reusable decorative frame component
 * Provides the red/navy bordered frame with gold corner decorations
 */
class PlayFrame extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    // Get the original content before replacing
    const content = this.innerHTML;

    this.innerHTML = `
      <div class="play-frame-outer">
        <div class="play-frame-inner">
          <span class="play-corner corner-tl"></span>
          <span class="play-corner corner-tr"></span>
          <span class="play-corner corner-bl"></span>
          <span class="play-corner corner-br"></span>
          <div class="play-frame-content">${content}</div>
        </div>
      </div>
    `;
  }
}

customElements.define('play-frame', PlayFrame);
