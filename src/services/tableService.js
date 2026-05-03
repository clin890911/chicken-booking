import { INITIAL_TABLES } from '../data/tables'

const STORAGE_KEY = 'chicken_tables_v1'

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_TABLES))
      return INITIAL_TABLES.slice()
    }
    return JSON.parse(raw)
  } catch {
    return INITIAL_TABLES.slice()
  }
}

function write(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function listAll() {
  return read()
}

export function toggle(number) {
  const list = read()
  const idx = list.findIndex(t => t.number === number)
  if (idx < 0) return null
  list[idx].isActive = !list[idx].isActive
  write(list)
  return list[idx]
}

export function setActive(number, isActive) {
  const list = read()
  const idx = list.findIndex(t => t.number === number)
  if (idx < 0) return null
  list[idx].isActive = isActive
  write(list)
  return list[idx]
}

export function reset() {
  write(INITIAL_TABLES.slice())
}
