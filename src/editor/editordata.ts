
import * as mode from './modes/mode'
import * as vscode from 'vscode'
import * as utils from '../utils'
import StringBuilder from "@tsdotnet/string-builder";
import * as word from './modes/word'
import { Mode } from 'fs';
import { last } from 'lodash';
type Insert = { name: 'INSERT', jmode: boolean }
type Normal = { name: 'NORMAL', numarg: number | undefined }
type Extend = { name: 'SELECT', numarg: number | undefined }
export type State = Insert | Normal | Extend;
export type StateName = 'INSERT' | 'NORMAL' | 'SELECT'

export class EditorManager {
    editor: vscode.TextEditor;
    objcache: mode.SelectedObjGroup | undefined = undefined;
    changeExpected: boolean = false;
    constructor(editor: vscode.TextEditor) {
        this.editor = editor;
    }
    get selections() {
        return this.editor.selections;
    }
    set selections(sels: readonly vscode.Selection[]) {
        this.objcache = undefined;
        this.editor.selections = sels;
        this.editor.revealRange(sels[0]);
        this.changeExpected = true;
    }
    getTextObjects(selmode: mode.SelectionMode) {
        if (this.objcache && this.objcache.selectionsMatch(this.editor, selmode)) {
            return { obj: this.objcache, changed: false };
        }
        const lastobj = this.objcache;
        this.objcache = selmode.selectionsToObjects(this, this.editor.selections);
        return { obj: this.objcache, changed: !lastobj || !lastobj.rangeMatch(this.editor.selections) }
    }
    collapseObjects(selmode: mode.SelectionMode) {
        return selmode.selectionsToObjects(this, this.editor.selections.map(x => new vscode.Selection(x.active, x.active)));
    }
    get document() {
        return this.editor.document;
    }
    changeSelection(objs: mode.SelectedObjGroup) {
        this.objcache = objs;
        this.editor.selections = objs.map(x => x.selection);
        this.editor.revealRange(this.editor.selections[0]);
        this.changeExpected = true;
    }
    get options() { return this.editor.options; }
    set selectionDecoration(decorationtype: vscode.TextEditorDecorationType) {
        this.editor.setDecorations(decorationtype, this.editor.selections);
    }
    clearDecoration(decorationtype: vscode.TextEditorDecorationType) {
        this.editor.setDecorations(decorationtype, []);
    }
    get tabSize() {
        const ts = this.editor.options.tabSize || 4;
        if (typeof ts === 'string') {
            return ts.length;
        } else {
            return ts;
        }
    }
    onSelectionChange(mode: mode.SelectionMode) {
        if (this.changeExpected) {
            this.changeExpected = false;
        } else {
            this.changeSelection(this.getTextObjects(mode).obj);
        }
    }
}

export class EditorData {
    private _state: State;
    private _mode: mode.SelectionMode;
    editor: EditorManager;
    statusbar: vscode.StatusBarItem;
    constructor(editor: vscode.TextEditor, mode: mode.SelectionMode) {
        this.editor = new EditorManager(editor);
        this._mode = mode;
        this.statusbar = vscode.window.createStatusBarItem("oomotion", vscode.StatusBarAlignment.Left, 0);
        this._state = { name: 'NORMAL', numarg: undefined };
        setTimeout(() => this.changeStateTo('NORMAL'), 10);
    }

    dispose() {
        this.statusbar.dispose();
        this.updateDecoration(undefined);
    }
    get mode() { return this._mode; }
    get state() { return this._state; }
    private set mode(mode: mode.SelectionMode) {
        if (this.state.name == 'NORMAL') {
            this.editor.changeSelection(this.editor.collapseObjects(mode));
        } else if (this.state.name == 'SELECT') {
            this.editor.changeSelection(this.editor.getTextObjects(mode).obj);
        }
        this.updateDecoration(mode);
        this._mode = mode;
        this.updateStatusBar();
    }
    changeModeTo(mode: mode.SelectionMode) {
        this.mode = mode;
    }
    changeStateTo(name: 'INSERT' | 'NORMAL' | 'SELECT') {
        if (name == 'INSERT') {
            this._state = { name, jmode: false };
            this.editor.options.cursorStyle = vscode.TextEditorCursorStyle.LineThin;
            this.editor.options.lineNumbers = vscode.TextEditorLineNumbersStyle.On;
            this.mode = this._mode;
        } else if (name == 'NORMAL') {
            this._state = { name, numarg: undefined };
            this.editor.options.cursorStyle = vscode.TextEditorCursorStyle.Line;
            this.editor.options.lineNumbers = vscode.TextEditorLineNumbersStyle.Relative;
            this.mode = this._mode;
        } else {
            this._state = { name, numarg: undefined };
            this.editor.options.cursorStyle = vscode.TextEditorCursorStyle.Block;
            this.editor.options.lineNumbers = vscode.TextEditorLineNumbersStyle.Relative;
        }
        vscode.commands.executeCommand("setContext", "oomotion-vscode.state", name);
    }
    clearNumarg() {
        if (this._state.name != 'INSERT') {
            this._state = { name: this._state.name, numarg: undefined}
        }
    }
    onCharTyped(ch: string) {
        if (this._state.name == 'INSERT') {
            if (!this._state.jmode) {
                if (ch === 'j') {
                    this._state.jmode = true;
                } else {
                    this._state.jmode = false;
                    vscode.commands.executeCommand('default:type', { text: ch });
                }
            } else {
                this._state.jmode = false;
                switch (ch) {
                    case 'k':
                    case 'j':
                        this._state = { name: 'NORMAL', numarg: undefined}
                        this.changeStateTo('NORMAL');
                        break;
                    default:
                        vscode.commands.executeCommand('default:type', { text: 'j' + ch });
                        break;
                }
            }
        } else  {
            if (utils.isDecimal(ch)) {
                this._state.numarg = this._state.numarg ? this._state.numarg : 0;
                this._state.numarg *= 10;
                this._state.numarg += parseInt(ch);
            }
        } 
    }
    private updateDecoration(newmode: mode.SelectionMode | undefined) {
        this.editor.clearDecoration(this._mode.decorationtype);
        if (newmode && this.state.name != 'INSERT') {
            this.editor.selectionDecoration = newmode.decorationtype;
        }
    }
    updateSelection(e: vscode.TextEditorSelectionChangeEvent) {
        if (this.state.name != 'INSERT') {
            this.editor.selectionDecoration = this.mode.decorationtype;
            if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
                this.editor.onSelectionChange(this._mode);
            }
        }
    }
    private updateStatusBar() {
        this.statusbar.text = `Ⓜ️ ${this._state.name} - ${this._mode.name}`;
        this.statusbar.show();
    }


}

export class EditorDataManager {
    editorData: EditorData | undefined = undefined;
    last_selection_mode: mode.SelectionMode = word;

    map<T>(f: (data: EditorData) => T): T | undefined {
        if (this.editorData) {
            return f(this.editorData);
        }
    }
    map_or_else<T>(f: (data: EditorData) => T, elsef: () => T): T | undefined {
        if (this.editorData) {
            return f(this.editorData);
        } else {
            return elsef();
        }
    }
    updateEditorData(e: vscode.TextEditor | undefined) {
        if (this.editorData) {
            this.last_selection_mode = this.editorData.mode;
            this.editorData.dispose();
        }
        if (e) {
            this.editorData = new EditorData(e, this.last_selection_mode);
        } else {
            this.editorData = undefined;
        }
    }


}

export function getNumArg(state: State, defaultnum: number = 1) {
    return 'numarg' in state ? (state.numarg || defaultnum) : defaultnum;
}