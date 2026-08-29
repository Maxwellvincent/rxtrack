/** Enter advances an eligible question, never a held key or text entry. */
export function advanceOnEnter(event, advance, enabled) {
  if (!enabled || event.key !== "Enter" || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target?.closest?.('input,textarea,select,[contenteditable="true"],summary,a,[data-highlight]')) return;
  event.preventDefault();
  event.stopPropagation();
  advance();
}
