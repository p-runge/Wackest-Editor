declare module 'fft.js' {
  class FFT {
    constructor(size: number)
    size: number
    createComplexArray(): number[]
    toComplexArray(input: ArrayLike<number>, storage?: number[]): number[]
    fromComplexArray(complex: ArrayLike<number>, storage?: number[]): number[]
    transform(out: number[], data: number[]): void
    inverseTransform(out: number[], data: number[]): void
    realTransform(out: number[], data: number[]): void
    completeSpectrum(data: number[]): void
  }
  export = FFT
}
