/**
 * Copyright (c) 2014-2024 The xterm.js authors. All rights reserved.
 * @license MIT
 *
 * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
 * @license MIT
 *
 * Originally forked from (with the author's permission):
 *   Fabrice Bellard's javascript vt100 for jslinux:
 *   http://bellard.org/jslinux/
 *   Copyright (c) 2011 Fabrice Bellard
 */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var MIN_COLS = 2
var MIN_ROWS = 1
class FitAddon {
  activate(terminal) {
    this._terminal = terminal
  }
  dispose() {}
  fit() {
    let dimensions = this.proposeDimensions()
    if (!dimensions || !this._terminal || isNaN(dimensions.cols) || isNaN(dimensions.rows)) return
    let core = this._terminal._core
    if (this._terminal.rows !== dimensions.rows || this._terminal.cols !== dimensions.cols) {
      core._renderService.clear()
      this._terminal.resize(dimensions.cols, dimensions.rows)
    }
  }
  proposeDimensions() {
    if (!this._terminal || !this._terminal.element || !this._terminal.element.parentElement) return
    let dims = this._terminal._core._renderService.dimensions
    if (dims.css.cell.width === 0 || dims.css.cell.height === 0) return
    let scrollbarWidth = this._terminal.options.scrollback === 0 ? 0 : this._terminal.options.overviewRuler?.width || 14
    let parentStyle = window.getComputedStyle(this._terminal.element.parentElement)
    let parentHeight = parseInt(parentStyle.getPropertyValue("height"))
    let parentWidth = Math.max(0, parseInt(parentStyle.getPropertyValue("width")))
    let terminalStyle = window.getComputedStyle(this._terminal.element)
    let padding = {
      top: parseInt(terminalStyle.getPropertyValue("padding-top")),
      bottom: parseInt(terminalStyle.getPropertyValue("padding-bottom")),
      right: parseInt(terminalStyle.getPropertyValue("padding-right")),
      left: parseInt(terminalStyle.getPropertyValue("padding-left")),
    }
    let verticalPadding = padding.top + padding.bottom
    let horizontalPadding = padding.right + padding.left
    let availableHeight = parentHeight - verticalPadding
    let availableWidth = parentWidth - horizontalPadding - scrollbarWidth
    return {
      cols: Math.max(MIN_COLS, Math.floor(availableWidth / dims.css.cell.width)),
      rows: Math.max(MIN_ROWS, Math.floor(availableHeight / dims.css.cell.height)),
    }
  }
}
export { FitAddon }
