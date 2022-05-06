export function split(source: string) {
  if (!source) return []
  return source.split(',').flatMap((value) => {
    if (!value.includes('..')) return +value
    const capture = value.split('..')
    const start = +capture[0], end = +capture[1]
    if (end < start) return []
    return new Array(end - start + 1).fill(0).map((_, index) => start + index)
  })
}

export function equal(array1: (string | number)[], array2: (string | number)[]) {
  return array1.slice().sort().join() === array2.slice().sort().join()
}

export const RE_DIALOGUES = /^\d+(\.\.\d+)?(,\d+(\.\.\d+)?)*$/
