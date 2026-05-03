// 初始桌位定義：33 張四人桌 (A1-A33) + 19 張六人桌 (B1-B19)
export const INITIAL_TABLES = [
  ...Array.from({ length: 33 }, (_, i) => ({
    number: `A${i + 1}`,
    capacity: 4,
    isActive: true
  })),
  ...Array.from({ length: 19 }, (_, i) => ({
    number: `B${i + 1}`,
    capacity: 6,
    isActive: true
  }))
]

export const TOTAL_CAPACITY = INITIAL_TABLES.reduce((sum, t) => sum + t.capacity, 0)
// 33*4 + 19*6 = 132 + 114 = 246
