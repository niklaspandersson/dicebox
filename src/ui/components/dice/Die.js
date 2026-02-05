/**
 * Shared Die component.
 * A single die display that can be used by any strategy.
 *
 * Attributes:
 * - value: Die face value (1-6), empty for blank
 * - color: Die background color (hex)
 * - selected: Present if die is selected
 * - rolling: Present if die is animating
 *
 * @example
 * <dice-die value="6" color="#ef4444"></dice-die>
 */
export class Die extends HTMLElement {
  static get observedAttributes() {
    return ["value", "color", "selected", "rolling"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const value = this.getAttribute("value");
    const color = this.getAttribute("color") || "#ffffff";
    const selected = this.hasAttribute("selected");
    const rolling = this.hasAttribute("rolling");

    const pipColor = this.#getPipColor(color);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }

        .die {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--die-color, ${color});
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          position: relative;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .die--selected {
          box-shadow: 0 0 0 3px #3b82f6, 0 2px 4px rgba(0, 0, 0, 0.2);
          transform: scale(1.05);
        }

        .die--rolling {
          animation: roll 0.1s linear infinite;
        }

        @keyframes roll {
          0% { transform: rotate(0deg); }
          25% { transform: rotate(5deg); }
          50% { transform: rotate(0deg); }
          75% { transform: rotate(-5deg); }
          100% { transform: rotate(0deg); }
        }

        .die__face {
          width: 40px;
          height: 40px;
        }

        .die__face svg {
          width: 100%;
          height: 100%;
        }

      </style>

      <div class="die ${selected ? "die--selected" : ""} ${rolling ? "die--rolling" : ""}"
           style="--die-color: ${color}">
        <div class="die__face">
          ${value ? this.#renderFace(parseInt(value), pipColor) : ""}
        </div>
      </div>
    `;
  }

  #renderFace(value, pipColor) {
    if (value < 1 || value > 6) return "";

    const pipPositions = {
      topLeft: { cx: 14, cy: 14 },
      topRight: { cx: 36, cy: 14 },
      midLeft: { cx: 14, cy: 25 },
      center: { cx: 25, cy: 25 },
      midRight: { cx: 36, cy: 25 },
      bottomLeft: { cx: 14, cy: 36 },
      bottomRight: { cx: 36, cy: 36 },
    };

    const pipConfigs = {
      1: ["center"],
      2: ["topRight", "bottomLeft"],
      3: ["topRight", "center", "bottomLeft"],
      4: ["topLeft", "topRight", "bottomLeft", "bottomRight"],
      5: ["topLeft", "topRight", "center", "bottomLeft", "bottomRight"],
      6: [
        "topLeft",
        "topRight",
        "midLeft",
        "midRight",
        "bottomLeft",
        "bottomRight",
      ],
    };

    const pips = pipConfigs[value]
      .map((pos) => {
        const p = pipPositions[pos];
        return `<circle cx="${p.cx}" cy="${p.cy}" r="5" fill="${pipColor}"/>`;
      })
      .join("");

    return `<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">${pips}</svg>`;
  }

  #getPipColor(diceColor) {
    // Light colors get dark pips
    if (
      diceColor === "#ffffff" ||
      diceColor === "#eab308" ||
      diceColor === "#fef9c3"
    ) {
      return "#0f172a";
    }
    return "#ffffff";
  }
}

// Register the component
if (!customElements.get("dice-die")) {
  customElements.define("dice-die", Die);
}
