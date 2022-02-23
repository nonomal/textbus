import { BehaviorSubject, distinctUntilChanged, Subject, Subscription } from '@tanbo/stream'

export class SelectionMask {
  private readonly mask: HTMLCanvasElement

  private readonly context: CanvasRenderingContext2D

  private onRectChange = new Subject<DOMRect>()

  private set maskWidth(v: number) {
    this._maskWidth = v
    this.mask.width = v
  }

  private get maskWidth() {
    return this._maskWidth
  }

  private set maskHeight(v: number) {
    this._maskHeight = v
    this.mask.height = v
  }

  private get maskHeight() {
    return this._maskHeight
  }

  private _maskWidth!: number
  private _maskHeight!: number

  private containerRect!: DOMRect

  private subscription: Subscription

  constructor(private subject: BehaviorSubject<DOMRect>,
              private document: Document,
              private container: HTMLElement) {
    this.mask = document.createElement('canvas')
    this.context = this.mask.getContext('2d')!

    Object.assign(this.mask.style, {
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none'
    })
    this.container.appendChild(this.mask)
    this.subscription = subject.subscribe(rect => {
      this.containerRect = rect
      this.maskWidth = rect.width
      this.maskHeight = rect.height
    })

    this.onRectChange.pipe(distinctUntilChanged((prev, current) => {
      return prev.top === current.top
    })).subscribe(rect => {
      this.context.fillStyle = 'rgba(18, 150, 219, .2)'
      this.context.beginPath()
      this.context.rect(rect.x - this.containerRect.x, rect.y - this.containerRect.y, rect.width, rect.height)
      this.context.fill()
      this.context.closePath()
    })
  }

  draw(range: Range) {
    const context = this.context
    context.clearRect(0, 0, this.maskWidth, this.maskHeight)

    if (range.collapsed) {
      return
    }

    const rects = range.getClientRects()
    for (let i = rects.length - 1; i >= 0; i--) {
      this.onRectChange.next(rects[i])
    }
  }

  destroy() {
    this.subscription.unsubscribe()
  }
}
