import { EditorOptions, Editor } from './lib/editor';
import {
  fontFamilyFormatter,
  boldFormatter,
  linkFormatter,
  backgroundColor,
  colorFormatter,
  fontSizeFormatter,
  italicFormatter,
  letterSpacingFormatter,
  lineHeightFormatter,
  strikeThroughFormatter,
  subscriptFormatter,
  superscriptFormatter,
  textAlignFormatter,
  textIndentFormatter,
  underlineFormatter
} from './lib/formatter/_api';
import {
  audioTool,
  blockBackgroundTool,
  blockquoteTool,
  boldTool,
  cleanTool,
  codeTool,
  colorTool,
  emojiTool,
  fontFamilyTool,
  fontSizeTool,
  headingTool,
  historyBackTool,
  historyForwardTool,
  imageTool,
  italicTool,
  letterSpacingTool,
  lineHeightTool,
  linkTool,
  olTool,
  strikeThroughTool,
  subscriptTool,
  superscriptTool,
  tableEditTool,
  tableTool,
  textAlignTool,
  textBackgroundTool,
  textIndentTool,
  ulTool,
  underlineTool,
  videoTool
} from './lib/toolbar/tools/_api';
import { CodeHook, DefaultHook, HistoryHook } from './lib/hooks/_api';
import {
  AudioTemplateTranslator,
  BlockTemplateTranslator,
  CodeTemplateTranslator,
  ImageTemplateTranslator,
  ListTemplateTranslator,
  SingleTemplateTranslator,
  TableTemplateTranslator,
  VideoTemplateTranslator
} from './lib/templates/_api';
import { defaultStyleSheets } from './lib/viewer/default-styles';

export const defaultOptions: EditorOptions = {
  styleSheets: defaultStyleSheets,
  hooks: [
    new CodeHook(),
    new DefaultHook(),
    new HistoryHook()
  ],
  templateTranslators: [
    new ListTemplateTranslator('ul'),
    new ListTemplateTranslator('ol'),
    new BlockTemplateTranslator('div,p,h1,h2,h3,h4,h5,h6,blockquote'.split(',')),
    new SingleTemplateTranslator('br'),
    new CodeTemplateTranslator(),
    new AudioTemplateTranslator(),
    new VideoTemplateTranslator(),
    new ImageTemplateTranslator(),
    new TableTemplateTranslator()
  ],
  formatters: [
    fontFamilyFormatter,
    boldFormatter,
    linkFormatter,
    backgroundColor,
    colorFormatter,
    fontSizeFormatter,
    italicFormatter,
    letterSpacingFormatter,
    lineHeightFormatter,
    strikeThroughFormatter,
    subscriptFormatter,
    superscriptFormatter,
    textAlignFormatter,
    textIndentFormatter,
    underlineFormatter
  ],
  toolbar: [
    // [historyBackTool, historyForwardTool],
    // [headingTool],
    // [boldTool, italicTool, strikeThroughTool, underlineTool],
    // [blockquoteTool],
    [codeTool],
    // [olTool, ulTool],
    // [fontSizeTool, lineHeightTool, letterSpacingTool, textIndentTool],
    // [subscriptTool, superscriptTool],
    // [colorTool, textBackgroundTool, blockBackgroundTool, emojiTool],
    // [fontFamilyTool],
    // [linkTool, imageTool, audioTool, videoTool],
    // [textAlignTool],
    // [tableTool, tableEditTool],
    // [cleanTool]
  ]
};

export function createEditor(selector: string | HTMLElement, options: EditorOptions = {}) {
  return new Editor(selector, Object.assign(defaultOptions, options));
}