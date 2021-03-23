import { from, fromEvent, Observable, of, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
  getAnnotations,
  Injector,
  NullInjector,
  ReflectiveInjector, Type,
} from '@tanbo/di';

import {
  AbstractComponent, BackboneAbstractComponent, BranchAbstractComponent,
  BrComponent,
  Component, DivisionAbstractComponent, Fragment, LeafAbstractComponent,
  OutputRenderer, Parser, Renderer, TBRange, TBSelection, VElementLiteral
} from './core/_api';
import {
  UIControlPanel,
  UIDialog, Input,
} from './ui/_api';
import { HTMLOutputTranslator, OutputTranslator } from './output-translator';
import { EditorController } from './editor-controller';
import { FileUploader } from './ui/uikit/forms/help';
import { makeError } from './_utils/make-error';
import { ComponentInjectors } from './component-injectors';
import { EditorOptions } from './editor-options';
import { EDITABLE_DOCUMENT, EDITOR_OPTIONS } from './inject-tokens';
import { Layout } from './ui/layout';
import { RootComponent } from './root-component';
import { TBHistory } from './history';
import { TBPlugin } from './ui/plugin';
import { BlockComponent } from './components/block.component';

declare const ResizeObserver: any;
const editorErrorFn = makeError('Editor');

export interface OutputContent<T = any> {
  content: T;
  links: Array<{ [key: string]: string }>;
  styleSheets: string[];
  scripts: string[];
}

/**
 * TextBus 主类
 */
export class Editor {
  /** 当 TextBus 可用时触发 */
  readonly onReady: Observable<void>;
  /** 当 TextBus 内容发生变化时触发 */
  readonly onChange: Observable<void>;

  readonly stateController: EditorController;

  injector: Injector = null;

  set readonly(b: boolean) {
    this.stateController.readonly = b;
  }

  get readonly() {
    return this.stateController.readonly;
  }

  private readonly container: HTMLElement;

  private componentAnnotations: Component[];
  private defaultPlugins: Type<TBPlugin>[] = [
    UIDialog,
    UIControlPanel
  ];
  private readyState = false;
  private tasks: Array<() => void> = [];

  private layout: Layout;

  private readyEvent = new Subject<void>();
  private resizeObserver: any;

  private subs: Subscription[] = [];

  constructor(public selector: string | HTMLElement, public options: EditorOptions) {
    if (typeof selector === 'string') {
      this.container = document.querySelector(selector);
    } else {
      this.container = selector;
    }
    if (!this.container || !(this.container instanceof HTMLElement)) {
      throw editorErrorFn('selector is not an HTMLElement, or the CSS selector cannot find a DOM element in the document.')
    }
    this.onReady = this.readyEvent.asObservable();
    this.stateController = new EditorController({
      readonly: false,
    });

    const rootInjector = new ReflectiveInjector(new NullInjector(), [Layout, {
      provide: EditorController,
      useValue: this.stateController
    }]);
    const layout = rootInjector.get(Layout);
    layout.setTheme(options.theme);
    this.layout = layout;
    this.subs.push(layout.onReady.subscribe(contentDocument => {
      const injector = this.init(rootInjector, contentDocument);
      this.injector = injector;
      this.tasks.forEach(fn => fn());
      const rootComponent = injector.get(RootComponent);
      const selection = injector.get(TBSelection);
      const renderer = injector.get(Renderer);
      const parser = injector.get(Parser);
      this.subs.push(
        rootComponent.onChange.pipe(debounceTime(1)).subscribe(() => {
          const isEmpty = rootComponent.slot.length === 0;
          Editor.guardLastIsParagraph(rootComponent.slot);
          if (isEmpty && selection.firstRange) {
            const position = selection.firstRange.findFirstPosition(rootComponent.slot);
            selection.firstRange.setStart(position.fragment, position.index);
            selection.firstRange.setEnd(position.fragment, position.index);
          }
          renderer.render(rootComponent, contentDocument.body);
          selection.restore();
        }),

        fromEvent(contentDocument, 'click').subscribe((ev: MouseEvent) => {
          const sourceElement = ev.target as Node;
          const focusNode = this.findFocusNode(sourceElement, renderer);
          if (!focusNode || focusNode === sourceElement) {
            return;
          }
          const position = renderer.getPositionByNode(focusNode);
          if (position.endIndex - position.startIndex === 1) {
            const content = position.fragment.getContentAtIndex(position.startIndex);
            if (content instanceof LeafAbstractComponent) {
              if (!selection.firstRange) {
                const range = new TBRange(contentDocument.createRange(), renderer);
                selection.addRange(range);
              }
              selection.firstRange.setStart(position.fragment, position.endIndex);
              selection.firstRange.collapse();
              selection.restore();
            }
          }
        })
      )

      const dom = Parser.parserHTML(this.options.contents || '<p><br></p>');
      rootComponent.slot.from(parser.parse(dom));
      this.listen(layout.iframe, layout.middle, contentDocument);

      [...(this.defaultPlugins), ...(this.options.plugins || [])].forEach(f => {
        injector.get(f).setup();
      })

      injector.get(Input);
      injector.get(TBHistory).record();

      this.readyState = true;
      this.readyEvent.next();
    }))
    this.container.appendChild(layout.container);
  }

  /**
   * 设置 TextBus 编辑器的内容。
   * @param html
   */
  setContents(html: string) {
    return new Promise((resolve) => {
      this.run(() => {
        const parser = this.injector.get(Parser);
        const fragment = parser.parse(Parser.parserHTML(html));
        this.injector.get(RootComponent).slot.from(fragment);
        resolve(true);
      })
    })
  }

  /**
   * 获取 TextBus 的内容。
   */
  getContents(): OutputContent<string> {
    const metadata = this.getOutputComponentMetadata()

    const outputTranslator = this.injector.get(OutputTranslator as Type<OutputTranslator>);
    const outputRenderer = this.injector.get(OutputRenderer);
    const rootComponent = this.injector.get(RootComponent);

    const content = outputTranslator.transform(outputRenderer.render(rootComponent));
    return {
      content,
      links: metadata.links,
      styleSheets: metadata.styles,
      scripts: metadata.scripts
    }
  }

  /**
   * 获取 TextBus 内容的 JSON 字面量。
   */
  getJSONLiteral(): OutputContent<VElementLiteral> {
    const outputRenderer = this.injector.get(OutputRenderer);
    const rootComponent = this.injector.get(RootComponent);
    const json = outputRenderer.render(rootComponent).toJSON();
    const metadata = this.getOutputComponentMetadata()
    return {
      content: json,
      links: metadata.links,
      styleSheets: metadata.styles,
      scripts: metadata.scripts
    }
  }

  /**
   * 销毁 TextBus 实例。
   */
  destroy() {
    this.subs.forEach(s => s.unsubscribe());
    // const rootInjector = this.rootInjector;
    // [Toolbar,
    //   Device,
    //   Dialog,
    //   FullScreen,
    //   LibSwitch,
    //   StatusBar,
    //   Viewer,
    //   ComponentStage,
    //   ControlPanel,
    //   Workbench,
    // ].forEach(c => {
    //   rootInjector.get(c as Type<{ destroy(): void }>).destroy();
    // })
    this.container.removeChild(this.layout.container);
  }

  private getOutputComponentMetadata() {
    const classes = this.getReferencedComponents();

    const styles: string[] = [...(this.options.styleSheets || '')];
    const scripts: string[] = [];
    const links: Array<{ [key: string]: string }> = [];

    classes.forEach(c => {
      const annotation = getAnnotations(c).getClassMetadata(Component).decoratorArguments[0] as Component;
      if (annotation.styles) {
        styles.push(...annotation.styles.filter(i => i));
      }
      if (annotation.scripts) {
        scripts.push(...annotation.scripts.filter(i => i));
      }
      if (annotation.links) {
        links.push(...annotation.links);
      }
    })
    return {
      links,
      styles: Array.from(new Set(styles)).map(i => Editor.cssMin(i)),
      scripts: Array.from(new Set(scripts))
    }
  }

  private getReferencedComponents() {

    function getComponentCollection(component: AbstractComponent) {
      const collection: AbstractComponent[] = [component];
      const fragments: Fragment[] = [];
      if (component instanceof DivisionAbstractComponent) {
        fragments.push(component.slot)
      } else if (component instanceof BranchAbstractComponent) {
        fragments.push(...component.slots);
      } else if (component instanceof BackboneAbstractComponent) {
        fragments.push(...Array.from(component));
      }
      fragments.forEach(fragment => {
        fragment.sliceContents().forEach(i => {
          if (i instanceof AbstractComponent) {
            collection.push(...getComponentCollection(i));
          }
        })
      })
      return collection;
    }

    const instances = getComponentCollection(this.injector.get(RootComponent));

    return Array.from(new Set(instances.map(i => i.constructor)))
  }

  private init(rootInjector: Injector, contentDocument: Document) {
    const renderer = new Renderer();
    const selection = new TBSelection(
      contentDocument,
      fromEvent(contentDocument, 'selectionchange'),
      renderer);

    this.componentAnnotations = [RootComponent, ...(this.options.components || []), BrComponent].map(c => {
      return getAnnotations(c).getClassMetadata(Component).decoratorArguments[0] as Component
    })

    this.setup(this.componentAnnotations, contentDocument);

    const parser = new Parser(this.componentAnnotations.map(c => c.loader), this.options.formatters);
    const componentInjectors = new ComponentInjectors();
    const editorInjector = new ReflectiveInjector(rootInjector, [
      ...this.defaultPlugins,
      Input,
      TBHistory,
      RootComponent, {
        provide: EDITABLE_DOCUMENT,
        useValue: contentDocument
      }, {
        provide: EDITOR_OPTIONS,
        useValue: this.options
      }, {
        provide: Editor,
        useValue: this
      }, {
        provide: OutputRenderer,
        useValue: new OutputRenderer()
      }, {
        provide: OutputTranslator,
        useValue: new HTMLOutputTranslator()
      }, {
        provide: Parser,
        useValue: parser
      }, {
        provide: TBSelection,
        useValue: selection
      }, {
        provide: Renderer,
        useValue: renderer
      }, {
        provide: ComponentInjectors,
        useValue: componentInjectors
      }, {
        provide: FileUploader,
        useFactory: () => {
          return {
            upload: (type: string): Observable<string> => {
              if (selection.rangeCount === 0) {
                alert('请先选择插入资源位置！');
                throw editorErrorFn('请先选择插入资源位置！');
              }
              if (typeof this.options.uploader === 'function') {

                const result = this.options.uploader(type);
                if (result instanceof Observable) {
                  return result;
                } else if (result instanceof Promise) {
                  return from(result);
                } else if (typeof result === 'string') {
                  return of(result);
                }
              }
              return of('');
            }
          }
        }
      }
    ])

    const customInjector: Injector = new ReflectiveInjector(editorInjector, [
      ...(this.options.providers || []),
      ...(this.options.plugins || []), {
        provide: Injector,
        useFactory() {
          return customInjector
        }
      }
    ]);
    [RootComponent, ...(this.options.components || [])].forEach(c => {
      const metadata = getAnnotations(c).getClassMetadata(Component);
      const annotation = metadata.decoratorArguments[0] as Component;
      componentInjectors.set(c, new ReflectiveInjector(customInjector, annotation.providers || []));
    });
    return customInjector;
  }

  private setup(componentAnnotations: Component[], contentDocument: Document) {
    const links: Array<{ [key: string]: string }> = [];

    const componentStyles = componentAnnotations.map(c => {
      if (Array.isArray(c.links)) {
        links.push(...c.links);
      }
      return [c.styles?.join('') || '', c.editModeStyles?.join('') || ''].join('')
    }).join('')

    links.forEach(link => {
      const linkEle = contentDocument.createElement('link');
      Object.assign(linkEle, link);
      contentDocument.head.appendChild(linkEle);
    })
    const docStyles = Editor.cssMin([componentStyles, ...(this.options.styleSheets || [])].join(''));
    const styleEl = contentDocument.createElement('style');
    styleEl.innerHTML = Editor.cssMin([...docStyles, ...(this.options.editingStyleSheets || [])].join(''));
    contentDocument.head.append(styleEl);
  }

  private run(fn: () => void) {
    if (!this.readyState) {
      this.tasks.push(fn);
      return;
    }
    fn();
  }

  private listen(iframe: HTMLIFrameElement, container: HTMLElement, contentDocument: Document) {
    if (!contentDocument?.body) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      const childBody = contentDocument.body;
      const lastChild = childBody.lastChild;
      let height = 0;
      if (lastChild) {
        if (lastChild.nodeType === Node.ELEMENT_NODE) {
          height = (lastChild as HTMLElement).getBoundingClientRect().bottom;
        } else {
          const div = contentDocument.createElement('div');
          childBody.appendChild(div);
          height = div.getBoundingClientRect().bottom;
          childBody.removeChild(div);
        }
      }
      iframe.style.height = Math.max(height, container.offsetHeight) + 'px';
    })
    this.resizeObserver.observe(contentDocument.body);
  }

  private findFocusNode(node: Node, renderer: Renderer): Node {
    const position = renderer.getPositionByNode(node);
    if (!position) {
      const parentNode = node.parentNode;
      if (parentNode) {
        return this.findFocusNode(parentNode, renderer);
      }
      return null;
    }
    return node;
  }

  private static cssMin(str: string) {
    return str
      .replace(/\s*(?=[>{}:;,[])/g, '')
      .replace(/([>{}:;,])\s*/g, '$1')
      .replace(/;}/g, '}').replace(/\s+/, ' ').trim();
  }

  private static guardLastIsParagraph(fragment: Fragment) {
    const last = fragment.sliceContents(fragment.length - 1)[0];
    if (last instanceof BlockComponent) {
      if (last.tagName === 'p') {
        if (last.slot.length === 0) {
          last.slot.append(new BrComponent());
        }
        return;
      }
    }
    const p = new BlockComponent('p');
    p.slot.append(new BrComponent());
    fragment.append(p);
  }
}
