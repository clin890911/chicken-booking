import { describe, it, expect } from 'vitest'
import { isValidTwPhone } from '../../src/utils/validation'

// 原始碼契約（src/utils/validation.js）：
//   const d = String(raw || '').replace(/\D/g, '')          // 先把所有非數字字元拿掉
//   return /^09\d{8}$/.test(d) || /^\d{8,10}$/.test(d)       // 09 手機 10 碼 或 純數字 8–10 碼
// 重點：因為先 strip 掉非數字，所有斷言都以「去掉非數字後剩下的數字字串」為準。

describe('isValidTwPhone', () => {
  describe('09 開頭手機（10 碼）— 正常路徑', () => {
    it('純數字 09 開頭 10 碼應通過', () => {
      expect(isValidTwPhone('0912345678')).toBe(true)
    })

    it('另一組合法手機號（0987654321）應通過', () => {
      expect(isValidTwPhone('0987654321')).toBe(true)
    })

    it('帶單一空白分隔的手機格式應正規化後通過', () => {
      expect(isValidTwPhone('0912 345 678')).toBe(true)
    })

    it('帶連字號的手機格式應正規化後通過', () => {
      expect(isValidTwPhone('0912-345-678')).toBe(true)
    })

    it('帶括號 / 空白混合的手機格式應正規化後通過', () => {
      expect(isValidTwPhone('(0912) 345-678')).toBe(true)
    })

    it('前後含空白的手機號應正規化後通過', () => {
      expect(isValidTwPhone('  0912345678  ')).toBe(true)
    })

    it('全形以外的分隔字元（點號）也會被 strip 而通過', () => {
      expect(isValidTwPhone('0912.345.678')).toBe(true)
    })
  })

  describe('市話 8–10 碼 — 正常路徑', () => {
    it('8 碼市話應通過（下界）', () => {
      expect(isValidTwPhone('12345678')).toBe(true)
    })

    it('9 碼市話應通過（中間）', () => {
      expect(isValidTwPhone('123456789')).toBe(true)
    })

    it('10 碼非 09 開頭（區碼市話）應通過（上界）', () => {
      expect(isValidTwPhone('0212345678')).toBe(true)
    })

    it('帶區碼連字號的市話應正規化後通過', () => {
      expect(isValidTwPhone('02-1234-5678')).toBe(true)
    })

    it('帶括號區碼的市話應正規化後通過', () => {
      expect(isValidTwPhone('(02) 2712-3456')).toBe(true)
    })
  })

  describe('過短應拒', () => {
    it('7 碼（少於 8）應拒', () => {
      expect(isValidTwPhone('1234567')).toBe(false)
    })

    it('1 碼應拒', () => {
      expect(isValidTwPhone('1')).toBe(false)
    })

    it('帶連字號但實際數字僅 7 碼應拒', () => {
      expect(isValidTwPhone('123-4567')).toBe(false)
    })
  })

  describe('過長應拒', () => {
    it('11 碼（多於 10）應拒', () => {
      expect(isValidTwPhone('12345678901')).toBe(false)
    })

    it('11 碼 09 開頭（多一碼的手機）應拒', () => {
      expect(isValidTwPhone('09123456789')).toBe(false)
    })

    it('帶空白但實際數字 11 碼應拒', () => {
      expect(isValidTwPhone('0912 3456 789')).toBe(false)
    })

    it('很長的數字串應拒', () => {
      expect(isValidTwPhone('091234567890123')).toBe(false)
    })
  })

  describe('空值 / 缺值應拒', () => {
    it('空字串應拒', () => {
      expect(isValidTwPhone('')).toBe(false)
    })

    it('null 應拒', () => {
      expect(isValidTwPhone(null)).toBe(false)
    })

    it('undefined 應拒', () => {
      expect(isValidTwPhone(undefined)).toBe(false)
    })

    it('未傳參數（arity 0）應拒', () => {
      expect(isValidTwPhone()).toBe(false)
    })

    it('只有空白的字串應拒（strip 後為空）', () => {
      expect(isValidTwPhone('     ')).toBe(false)
    })

    it('只有分隔符號沒有數字的字串應拒', () => {
      expect(isValidTwPhone('---  ()')).toBe(false)
    })

    it('false 應拒（String(false||"") => ""）', () => {
      expect(isValidTwPhone(false)).toBe(false)
    })

    it('0（falsy）應拒（String(0||"") => "" -> 無數字）', () => {
      expect(isValidTwPhone(0)).toBe(false)
    })
  })

  describe('純字母 / 無有效數字應拒', () => {
    it('全字母字串（strip 後為空）應拒', () => {
      expect(isValidTwPhone('abcdefghij')).toBe(false)
    })

    it('全中文字串應拒', () => {
      expect(isValidTwPhone('請打電話給我')).toBe(false)
    })

    it('字母 + 太少數字（strip 後 < 8 碼）應拒', () => {
      // 'phone007' -> '007' 只有 3 碼
      expect(isValidTwPhone('phone007')).toBe(false)
    })
  })

  describe('型別 / 非字串輸入', () => {
    it('數字型別 1234567890（10 位數）應通過（String 轉換後為 10 碼）', () => {
      expect(isValidTwPhone(1234567890)).toBe(true)
    })

    it('數字型別 912345678（9 碼，09 開頭手機去掉前導 0 的情況）— 9 碼通過 8–10 規則', () => {
      // 注意：number 912345678 沒有前導 0，String 後為 9 碼 → 落在 8–10 市話規則 → 通過
      expect(isValidTwPhone(912345678)).toBe(true)
    })
  })

  // 含英文字母的電話一律拒（即使去掉字母後剛好湊成 8–10 碼也不算合法）
  describe('含字母的電話號碼應拒', () => {
    it('09 手機中夾雜字母拒 — 例如 "0912abc345678"（去字母後雖為 10 碼仍拒）', () => {
      expect(isValidTwPhone('0912abc345678')).toBe(false)
    })

    it('字母混入拒 — 例如 "12a456789"（去字母後雖 8 碼仍拒）', () => {
      expect(isValidTwPhone('12a456789')).toBe(false)
    })
  })
})
