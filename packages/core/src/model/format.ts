import { BlockFormatter, Formatter, FormatType, InlineFormatter } from './formatter'
import { Slot } from './slot'

export class CleanFormatRule {
  constructor(public value: string | number | boolean | null | Record<string, string | number | boolean>) {
  }
}

export type FormatValue = string | number | boolean | null | Record<string, string | number | boolean> | CleanFormatRule

export type Formats = [formatter: Formatter, value: FormatValue][]

export interface FormatRange {
  startIndex: number
  endIndex: number
  value: FormatValue
}

export interface FormatLiteral {
  [key: string]: FormatRange[]
}

export interface FormatItem {
  formatter: Formatter
  value: FormatValue,
  startIndex: number
  endIndex: number
}

export interface FormatTree {
  startIndex: number
  endIndex: number
  children?: FormatTree[]
  formats?: FormatItem[]
}

function isVoid(data: any) {
  return data === null || typeof data === 'undefined'
}

/**
 * Textbus 格式管理类
 */
export class Format {
  private map = new Map<Formatter, FormatRange[]>()

  constructor(private slot: Slot) {
  }

  /**
   * 将新样式合并到现有样式中
   * @param formatter
   * @param data
   */
  merge(formatter: BlockFormatter, data: FormatValue): this
  merge(formatter: InlineFormatter, data: FormatRange): this
  merge(formatter: any, data: any): this {
    if (formatter.type === FormatType.Block) {
      if (isVoid(data)) {
        this.map.delete(formatter)
        return this
      }
      if (formatter.overlap) {
        if (data instanceof CleanFormatRule) {
          if (isVoid(data.value)) {
            this.map.delete(formatter)
          }
        } else {
          const oldRanges = this.map.get(formatter) || []
          const map = Format.formatRangesToMap(oldRanges)
          map.set(formatter, [{
            startIndex: 0,
            endIndex: this.slot.length,
            value: data
          }])

          this.map.set(formatter, Array.from(map.values()).flat())
        }
      } else if (data instanceof CleanFormatRule) {
        const value = data.value
        if (isVoid(value)) {
          this.map.delete(formatter)
        } else {
          const oldRanges = this.map.get(formatter)
          if (oldRanges && Format.equal(oldRanges[0]?.value, value)) {
            this.map.delete(formatter)
          }
        }
      } else {
        this.map.set(formatter, [{
          startIndex: 0,
          endIndex: this.slot.length,
          value: data
        }])
      }
      return this
    }
    let ranges = this.map.get(formatter)
    if (!ranges) {
      const v = data.value
      if (isVoid(v)) {
        return this
      }
      ranges = [data]
      this.map.set(formatter, ranges)
      return this
    }

    const newRanges = this.normalizeFormatRange(formatter, ranges, data)
    if (newRanges.length) {
      this.map.set(formatter, newRanges)
    } else {
      this.map.delete(formatter)
    }
    return this
  }

  /**
   * 将 index 后的样式起始和结束位置均增加 count 大小
   * @param index
   * @param count
   */
  stretch(index: number, count: number) {
    this.map.forEach(values => {
      values.forEach(range => {
        if (range.endIndex < index) {
          return
        }
        range.endIndex += count
        if (range.startIndex >= index) {
          range.startIndex += count
        }
      })
    })
    return this
  }

  /**
   * 将指定 index 位置后的样式向后平移 distance 长度
   * @param index
   * @param distance
   */
  split(index: number, distance: number) {
    const expandedValues = Array.from<string>({ length: distance })
    Array.from(this.map).forEach(([key, formatRanges]) => {
      if (key.type === FormatType.Block) {
        formatRanges.forEach(i => {
          i.endIndex += distance
        })
        return
      }
      if (key.overlap) {
        const groups = Format.formatRangesToMap(formatRanges)
        const ranges: FormatRange[] = []
        groups.forEach(group => {
          const values = this.tileRanges(group)
          values.splice(index, 0, ...expandedValues)
          ranges.push(...Format.toRanges(values))
        })
        this.map.set(key, ranges)
      } else {
        const values = this.tileRanges(formatRanges)
        values.splice(index, 0, ...expandedValues)
        const newRanges = Format.toRanges(values)
        this.map.set(key, newRanges)
      }
    })
    return this
  }

  /**
   * 从指定 index 位置的样式删除 count
   * @param startIndex
   * @param count
   */
  shrink(startIndex: number, count: number) {
    this.map.forEach(values => {
      values.forEach(range => {
        if (range.endIndex <= startIndex) {
          return
        }
        range.endIndex = Math.max(startIndex, range.endIndex - count)
        if (range.startIndex > startIndex) {
          range.startIndex = Math.max(startIndex, range.startIndex - count)
        }
      })
    })
    Array.from(this.map.keys()).forEach(key => {
      const oldRanges = this.map.get(key)!
      const newRanges = this.normalizeFormatRange(key, oldRanges)
      if (newRanges.length) {
        this.map.set(key, newRanges)
      } else {
        this.map.delete(key)
      }
    })
    return this
  }

  /**
   * 提取指定范围内的样式
   * @param startIndex
   * @param endIndex
   */
  extract(startIndex: number, endIndex: number): Format {
    const format = new Format(this.slot)
    this.map.forEach((ranges, key) => {
      const extractRanges = this.extractFormatRangesByFormatter(startIndex, endIndex, key)
      if (extractRanges.length) {
        format.map.set(key, extractRanges)
      }
    })
    return format
  }

  /**
   * 生成一个重置位置的 format
   * @param slot
   * @param startIndex
   * @param endIndex
   */
  createFormatByRange(slot: Slot, startIndex: number, endIndex: number) {
    const format = new Format(slot)
    this.map.forEach((ranges, key) => {
      const extractRanges = this.extractFormatRangesByFormatter(startIndex, endIndex, key)
      if (extractRanges.length) {
        format.map.set(key, extractRanges.map(i => {
          i.startIndex -= startIndex
          i.endIndex -= startIndex
          return i
        }))
      }
    })
    return format
  }

  /**
   * 通过 formatter 提取指定范围内的样式数据
   * @param startIndex
   * @param endIndex
   * @param formatter
   */
  extractFormatRangesByFormatter(startIndex: number, endIndex: number, formatter: Formatter) {
    const extractRanges: FormatRange[] = []

    const ranges = this.map.get(formatter) || []
    ranges.forEach(range => {
      if (range.startIndex > endIndex || range.endIndex < startIndex) {
        return
      }
      const s = Math.max(range.startIndex, startIndex)
      const n = Math.min(range.endIndex, endIndex)
      if (s < n) {
        extractRanges.push({
          startIndex: s,
          endIndex: n,
          value: range.value
        })
      }
    })
    return extractRanges
  }

  /**
   * 丢弃指定范围内的样式
   * @param formatter
   * @param startIndex
   * @param endIndex
   */
  discard(formatter: Formatter, startIndex: number, endIndex: number) {
    const oldRanges = this.map.get(formatter)
    if (oldRanges) {
      this.normalizeFormatRange(formatter, oldRanges, {
        startIndex,
        endIndex,
        value: null as any
      })
    }
    return this
  }

  /**
   * 获取指定下标生效的格式
   * @param index
   */
  extractFormatsByIndex(index: number) {
    const formats: Formats = []
    if (index === 0) {
      this.map.forEach((ranges, formatter) => {
        ranges.forEach(i => {
          if (i.startIndex === 0) {
            formats.push([
              formatter,
              i.value
            ])
          }
        })
      })
    } else {
      this.map.forEach((ranges, formatter) => {
        ranges.forEach(i => {
          if (i.startIndex < index && i.endIndex >= index) {
            formats.push([
              formatter,
              i.value
            ])
          }
        })
      })
    }
    return formats
  }

  toGrid() {
    const splitPoints = new Set<number>()
    splitPoints.add(0)
    splitPoints.add(this.slot.length)
    this.map.forEach(ranges => {
      ranges.forEach(item => {
        splitPoints.add(item.startIndex)
        splitPoints.add(item.endIndex)
      })
    })
    return [...splitPoints].sort((a, b) => a - b)
  }

  toJSON() {
    const json: FormatLiteral = {}
    this.map.forEach((value, formatter) => {
      json[formatter.name] = value.map(i => ({ ...i }))
    })
    return json
  }

  toTree(startIndex: number, endIndex: number): FormatTree {
    const copyFormat = this.extract(startIndex, endIndex)
    const tree: FormatTree = {
      startIndex,
      endIndex,
    }

    let nextStartIndex = endIndex
    let nextEndIndex = startIndex
    const formats: FormatItem[] = []
    const columnedFormats: FormatItem[] = []

    Array.from(copyFormat.map.keys()).forEach(formatter => {
      const ranges = copyFormat.map.get(formatter)!

      for (let index = ranges.length - 1; index > -1; index--) {
        const range = ranges[index]
        if (range.startIndex === startIndex && range.endIndex === endIndex) {
          if (formatter.columned) {
            columnedFormats.push({
              formatter,
              ...range
            })
          } else {
            formats.push({
              formatter,
              ...range
            })
            ranges.splice(index, 1)
            if (ranges.length === 0) {
              copyFormat.map.delete(formatter)
            }
          }
        } else if (range.startIndex < nextStartIndex) {
          nextStartIndex = range.startIndex
          nextEndIndex = range.endIndex
        } else if (range.startIndex === nextStartIndex) {
          nextEndIndex = Math.max(nextEndIndex, range.endIndex)
        }
      }
    })

    let rangeCount = 0
    copyFormat.map.forEach(v => {
      rangeCount += v.length
    })

    const hasChildren = rangeCount > columnedFormats.length
    if (hasChildren) {
      tree.children = []
      if (startIndex < nextStartIndex) {
        if (columnedFormats.length) {
          const childTree = copyFormat.extract(startIndex, nextStartIndex).toTree(startIndex, nextStartIndex)
          tree.children.push(childTree)
        } else {
          tree.children.push({
            startIndex,
            endIndex: nextStartIndex
          })
        }
      }

      const push = function (tree: FormatTree, childTree: FormatTree) {
        if (childTree.formats) {
          tree.children!.push(childTree)
        } else if (childTree.children) {
          tree.children!.push(...childTree.children)
        } else {
          tree.children!.push(childTree)
        }
      }
      const nextTree = copyFormat.toTree(nextStartIndex, nextEndIndex)
      push(tree, nextTree)

      if (nextEndIndex < endIndex) {
        const afterFormat = copyFormat.extract(nextEndIndex, endIndex)
        const afterTree = afterFormat.toTree(nextEndIndex, endIndex)
        push(tree, afterTree)
      }
    } else {
      formats.push(...columnedFormats)
    }

    if (formats.length) {
      tree.formats = formats
    }
    return tree
  }

  toArray() {
    const list: FormatItem[] = []
    Array.from(this.map).forEach(i => {
      const formatter = i[0]
      i[1].forEach(range => {
        list.push({
          ...range,
          formatter
        })
      })
    })
    return list
  }

  private normalizeFormatRange(formatter: Formatter, oldRanges: FormatRange[], newRange?: FormatRange): FormatRange[] {
    if (formatter.overlap) {
      let valueGroups: FormatRange[][]
      if (newRange) {
        const value = newRange.value
        if (value instanceof CleanFormatRule) {
          const map = Format.formatRangesToMap(oldRanges)
          if (isVoid(value.value)) {
            map.forEach(ranges => {
              ranges.push({
                ...newRange,
                value: null
              })
            })
          } else {
            for (const item of map.keys()) {
              if (Format.equal(item, value.value)) {
                map.get(item)!.push({
                  ...newRange,
                  value: null
                })
                break
              }
            }
          }
          valueGroups = Array.from(map.values())
        } else if (isVoid(value)) {
          const map = Format.formatRangesToMap(oldRanges)
          map.forEach(ranges => {
            ranges.push({
              ...newRange,
              value: null
            })
          })
          valueGroups = Array.from(map.values())
        } else {
          valueGroups = Array.from(Format.formatRangesToMap([newRange, ...oldRanges]).values())
        }
      } else {
        valueGroups = Array.from(Format.formatRangesToMap(oldRanges).values())
      }
      const result: FormatRange[] = []
      for (const item of valueGroups) {
        result.push(...Format.toRanges(this.tileRanges(item)))
      }
      return result
    }
    if (newRange) {
      const value = newRange.value
      if (value instanceof CleanFormatRule) {
        const map = Format.formatRangesToMap(oldRanges)
        if (isVoid(value.value)) {
          oldRanges = [...oldRanges, newRange]
        } else {
          for (const item of map.keys()) {
            if (Format.equal(item, value)) {
              const values = this.tileRanges(map.get(item)!)
              const { startIndex, endIndex } = newRange
              const cleanValues = Array.from<null>({ length: endIndex - startIndex }).fill(null)
              values.splice(startIndex, endIndex - startIndex, ...cleanValues)
              map.set(item, Format.toRanges(cleanValues))
              break
            }
          }
          oldRanges = Array.from(map.values()).flat()
        }
      } else {
        oldRanges = [...oldRanges, newRange]
      }
    }
    const formatValues: Array<FormatValue> = this.tileRanges(oldRanges)

    return Format.toRanges(formatValues)
  }

  private tileRanges(ranges: FormatRange[]) {
    const formatValues: Array<FormatValue> = []
    ranges.forEach(range => {
      formatValues.length = Math.max(formatValues.length, range.endIndex)
      formatValues.fill(range.value, range.startIndex, range.endIndex)
    })
    formatValues.length = Math.min(formatValues.length, this.slot.length)
    return formatValues
  }

  private static formatRangesToMap(oldRanges: FormatRange[]) {
    const map = new Map<any, FormatRange[]>()
    const keys: any[] = []
    for (const item of oldRanges) {
      let hasKey = false
      for (const key of keys) {
        if (Format.equal(key, item.value)) {
          hasKey = true
          map.get(key)!.push(item)
          break
        }
      }
      if (!hasKey) {
        keys.push(item.value)
        map.set(item.value, [item])
      }
    }
    return map
  }

  private static toRanges(values: Array<FormatValue>) {
    const newRanges: FormatRange[] = []
    let range: FormatRange = null as any
    for (let i = 0; i < values.length; i++) {
      const item = values[i]
      if (isVoid(item)) {
        range = null as any
        continue
      }
      if (Format.equal(range?.value, item)) {
        range.endIndex = i + 1
        continue
      }
      range = {
        startIndex: i,
        endIndex: i + 1,
        value: item
      }
      newRanges.push(range)
    }

    return newRanges
  }

  private static equal(left: FormatValue, right: FormatValue): boolean {
    if (left === right) {
      return true
    }
    if (typeof left === 'object' && typeof right === 'object') {
      const leftKeys = Object.keys(left!)
      const rightKeys = Object.keys(right!)
      if (leftKeys.length === rightKeys.length) {
        return leftKeys.every(key => {
          return rightKeys.includes(key) && right![key] === left![key]
        })
      }
    }
    return false
  }
}
