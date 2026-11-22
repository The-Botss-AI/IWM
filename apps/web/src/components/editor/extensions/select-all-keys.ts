import { Extension } from '@tiptap/core';
import { AllSelection, Selection } from '@tiptap/pm/state';

/**
 * After Mod-A the selection is a ProseMirror AllSelection, which browsers do
 * not collapse on Home or End, so the next keystroke replaced the whole
 * document. Collapse it to the document's start or end instead, the way other
 * editors do. Any other selection keeps the browser's own behaviour.
 */
export const SelectAllKeys = Extension.create({
  name: 'selectAllKeys',

  addKeyboardShortcuts() {
    const collapse = (toEnd: boolean) => (): boolean => {
      const { state, view } = this.editor;
      if (!(state.selection instanceof AllSelection)) return false;
      const target = toEnd ? Selection.atEnd(state.doc) : Selection.atStart(state.doc);
      view.dispatch(state.tr.setSelection(target).scrollIntoView());
      return true;
    };
    return { End: collapse(true), Home: collapse(false) };
  },
});
