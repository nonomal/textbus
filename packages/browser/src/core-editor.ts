import { BehaviorSubject, Observable, Subject, Subscription } from '@tanbo/stream'
import { Injector, Provider, Type } from '@tanbo/di'
import {
  NativeRenderer,
  NativeSelectionBridge,
  Renderer,
  RootComponentRef,
  Translator,
  makeError,
  OutputRenderer,
  bootstrap,
  Starter,
  ComponentInstance,
} from '@textbus/core'

import { Parser, OutputTranslator, ComponentResources, ComponentLoader } from './dom-support/_api'
import { createElement } from './_utils/uikit'
import {
  BaseEditorOptions,
  Input,
  EDITABLE_DOCUMENT,
  EDITOR_CONTAINER,
  EDITOR_OPTIONS,
  DomRenderer,
  SelectionBridge, Plugin, EDITOR_MASK, RESIZE_OBSERVER
} from './core/_api'
import { DefaultShortcut } from './preset/_api'

export interface OutputContents<T = any> {
  content: T
  resourcesList: Array<{ componentName: string, resources: ComponentResources }>
  styleSheets: string[]
}

const editorError = makeError('CoreEditor')

/**
 * TextBus PC 端编辑器
 */
export class CoreEditor {
  /** 当编辑器内容变化时触发 */
  onChange: Observable<void>

  /** 访问编辑器内部实例的 IoC 容器 */
  injector: Starter | null = null

  /** 编辑器是否已销毁 */
  destroyed = false
  /** 编辑器是否已准备好 */
  isReady = false
  /** 编辑器的默认配置项*/
  options: BaseEditorOptions | null = null

  protected plugins: Plugin[] = []

  protected defaultPlugins: Type<Plugin>[] = [
    DefaultShortcut,
  ]

  protected changeEvent = new Subject<void>()

  protected subs: Subscription[] = []

  private workbench!: HTMLElement

  constructor() {
    this.onChange = this.changeEvent.asObservable()
  }

  /**
   * 初始化编辑器
   * @param host 编辑器容器
   * @param rootComponentLoader 根组件加载器
   * @param options 编辑器的配置项
   */
  init(host: HTMLElement, rootComponentLoader: ComponentLoader, options: BaseEditorOptions = {}): Promise<Injector> {
    if (this.destroyed) {
      return Promise.reject(editorError('the editor instance is destroyed!'))
    }
    this.options = options
    this.plugins = options.plugins || []
    const {doc, mask, wrapper} = CoreEditor.createLayout()
    host.appendChild(wrapper)
    this.workbench = wrapper
    const staticProviders: Provider[] = [{
      provide: EDITABLE_DOCUMENT,
      useValue: document
    }, {
      provide: EDITOR_OPTIONS,
      useValue: options
    }, {
      provide: EDITOR_CONTAINER,
      useValue: wrapper
    }, {
      provide: RESIZE_OBSERVER,
      useFactory: () => {
        const subject = new BehaviorSubject<DOMRect>(wrapper.getBoundingClientRect())
        const resizeObserver = new ResizeObserver(() => {
          subject.next(wrapper.getBoundingClientRect())
        })
        resizeObserver.observe(wrapper)
        this.subs.push(new Subscription(() => {
          resizeObserver.disconnect()
        }))
        return subject
      }
    }, {
      provide: EDITOR_MASK,
      useValue: mask
    }, {
      provide: NativeRenderer,
      useClass: DomRenderer
    }, {
      provide: NativeSelectionBridge,
      useClass: SelectionBridge
    }, {
      provide: CoreEditor,
      useValue: this
    }]
    return bootstrap({
      components: (options.componentLoaders || []).map(i => i.component),
      formatters: (options.formatLoaders || []).map(i => i.formatter),
      platformProviders: [
        ...staticProviders,
        ...this.defaultPlugins,
        ...(options.providers || []),
        DomRenderer,
        Parser,
        Input,
        SelectionBridge,
        OutputTranslator,
      ]
    }).then(starter => {
      const parser = starter.get(Parser)
      const translator = starter.get(Translator)

      let component: ComponentInstance
      const content = options.content
      if (content) {
        if (typeof content === 'string') {
          component = parser.parseDoc(content, rootComponentLoader)
        } else {
          const data = rootComponentLoader.component.transform(translator, content.data)
          component = rootComponentLoader.component.createInstance(starter, data)
        }
      } else {
        component = rootComponentLoader.component.createInstance(starter)
      }

      starter.mount(component, doc)
      const renderer = starter.get(Renderer)
      this.defaultPlugins.forEach(i => starter.get(i).setup(starter))
      this.subs.push(renderer.onViewChecked.subscribe(() => {
        this.changeEvent.next()
      }))
      starter.get(Input)
      this.isReady = true
      this.injector = starter
      return starter
    })
  }

  /**
   * 获取 content 为 HTML 格式的内容
   */
  getContents(): OutputContents<string> {
    if (this.destroyed) {
      throw editorError('the editor instance is destroyed!')
    }
    if (!this.isReady) {
      throw editorError('please wait for the editor to initialize before getting the content!')
    }
    const injector = this.injector!

    const outputRenderer = injector.get(OutputRenderer)
    const outputTranslator = injector.get(OutputTranslator)

    const vDom = outputRenderer.render()
    const html = outputTranslator.transform(vDom)

    return {
      content: html,
      resourcesList: this.getAllComponentResources(),
      styleSheets: this.options?.styleSheets || []
    }
  }

  /**
   * 获取 content 为 JSON 格式的内容
   */
  getJSON(): OutputContents {
    if (this.destroyed) {
      throw editorError('the editor instance is destroyed!')
    }
    if (!this.isReady) {
      throw editorError('please wait for the editor to initialize before getting the content!')
    }
    const injector = this.injector!

    const rootComponentRef = injector.get(RootComponentRef)

    return {
      content: rootComponentRef.component.toJSON(),
      resourcesList: this.getAllComponentResources(),
      styleSheets: this.options?.styleSheets || []
    }
  }

  /**
   * 销毁编辑器
   */
  destroy() {
    if (this.destroyed) {
      return
    } else {
      this.destroyed = true
      this.subs.forEach(i => i.unsubscribe())
      this.plugins.forEach(i => {
        i.onDestroy?.()
      })
      if (this.injector) {
        const types = [
          Input,
        ]
        types.forEach(i => {
          this.injector!.get(i as Type<{ destroy(): void }>).destroy()
        })
        this.injector.destroy()
      }
      this.workbench.parentNode?.removeChild(this.workbench)
    }
  }

  private getAllComponentResources() {
    const resources: Array<{ componentName: string, resources: ComponentResources }> = []
    this.options!.componentLoaders?.forEach(i => {
      if (i.resources) {
        resources.push({
          componentName: i.component.name,
          resources: i.resources
        })
      }
    })

    return resources
  }

  private static createLayout() {
    const id = 'textbus-' + Number((Math.random() + '').substring(2)).toString(16)
    const doc = createElement('div', {
      styles: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 0,
        userSelect: 'text'
      },
      props: {
        id
      }
    })
    const style = createElement('style', {
      props: {
        innerHTML: `#${id} *::selection{background-color: rgba(18, 150, 219, .2)}`
      }
    })
    const mask = createElement('div', {
      styles: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 1,
        pointerEvents: 'none'
      }
    })
    const wrapper = createElement('div', {
      styles: {
        width: '100%',
        height: '100%',
        position: 'relative',
        minHeight: '100%',
        background: '#fff',
      },
      children: [doc, style, mask]
    })
    return {
      wrapper,
      doc,
      mask
    }
  }
}
