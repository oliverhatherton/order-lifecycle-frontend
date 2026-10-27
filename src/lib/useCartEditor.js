import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'

/** Taps on one product within this window are combined into a single request. */
const BATCH_MS = 250

export function quantityInCart(cart, productId) {
  return cart?.items?.find((i) => i.productId === productId)?.quantity ?? 0
}

/**
 * Applies the cart a set/remove request for `productId` sent back, taking only
 * that product's line from it. Requests for different products can be in
 * flight at once and their responses can arrive in any order, so another
 * product's line in this response may be older than the one already held.
 */
function mergeLine(prev, next, productId) {
  if (!prev || prev.id !== next.id) return next
  const held = new Map(prev.items.map((i) => [i.productId, i]))
  const items = []
  for (const item of next.items) {
    if (item.productId === productId) items.push(item)
    else if (held.has(item.productId)) items.push(held.get(item.productId))
  }
  for (const item of prev.items) {
    if (item.productId !== productId && !next.items.some((i) => i.productId === item.productId)) items.push(item)
  }
  return { ...next, items }
}

/**
 * Optimistic cart editing. `setQuantity` shows the new quantity immediately
 * (as an override on top of the server's cart) and batches taps per product:
 * the final quantity is sent once taps stop for BATCH_MS, and if a request
 * for that product is still in flight, the latest quantity goes as soon as it
 * returns. Each response is the server's cart, so nothing is refetched. On a
 * failure the product's override is dropped — it snaps back to the server's
 * value — and `onError` is called.
 */
export function useCartEditor({ onError }) {
  const [cart, setCartState] = useState(null)
  const [overrides, setOverrides] = useState(() => new Map()) // productId -> quantity not yet confirmed
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const [editor] = useState(() => {
    let currentCart = null
    let currentOverrides = new Map()
    const slots = new Map() // productId -> { timer, inFlight }

    function slotFor(id) {
      if (!slots.has(id)) slots.set(id, { timer: null, inFlight: null })
      return slots.get(id)
    }

    function setCart(next) {
      currentCart = next
      setCartState(next)
    }

    function writeOverride(id, quantity) {
      currentOverrides = new Map(currentOverrides)
      if (quantity === undefined) currentOverrides.delete(id)
      else currentOverrides.set(id, quantity)
      setOverrides(currentOverrides)
    }

    /** Sends the product's latest quantity; resolves false if a request failed. */
    function send(id) {
      const slot = slotFor(id)
      const quantity = currentOverrides.get(id)
      if (quantity === undefined) return Promise.resolve(true)
      if (quantity === quantityInCart(currentCart, id)) {
        writeOverride(id, undefined)
        return Promise.resolve(true)
      }
      const request = quantity <= 0 ? api.removeCartItem(id) : api.setCartItem(id, quantity)
      slot.inFlight = request.then(
        ({ data }) => {
          slot.inFlight = null
          setCart(mergeLine(currentCart, data, id))
          if (currentOverrides.get(id) === quantity) {
            writeOverride(id, undefined)
            return true
          }
          // Tapped again while this was in flight: a pending timer will send
          // the latest value, otherwise send it now.
          return slot.timer ? true : send(id)
        },
        (err) => {
          slot.inFlight = null
          clearTimeout(slot.timer)
          slot.timer = null
          writeOverride(id, undefined)
          onErrorRef.current?.(err)
          return false
        },
      )
      return slot.inFlight
    }

    return {
      setCart,

      setQuantity(id, quantity) {
        writeOverride(id, quantity)
        const slot = slotFor(id)
        clearTimeout(slot.timer)
        slot.timer = setTimeout(() => {
          slot.timer = null
          if (!slot.inFlight) send(id)
        }, BATCH_MS)
      },

      /** Sends every unsent change now and waits for them all; false if any failed. */
      async flush() {
        for (;;) {
          const waits = [...currentOverrides.keys()].map((id) => {
            const slot = slotFor(id)
            clearTimeout(slot.timer)
            slot.timer = null
            return slot.inFlight ?? send(id)
          })
          if (waits.length === 0) return true
          if ((await Promise.all(waits)).includes(false)) return false
        }
      },

      /** Sends batched changes right away rather than dropping them (on unmount). */
      sendPending() {
        for (const [id, slot] of slots) {
          if (!slot.timer) continue
          clearTimeout(slot.timer)
          slot.timer = null
          if (!slot.inFlight) send(id)
        }
      },
    }
  })

  useEffect(() => () => editor.sendPending(), [editor])

  return {
    cart,
    setCart: editor.setCart,
    quantityOf: (productId) => overrides.get(productId) ?? quantityInCart(cart, productId),
    overrides,
    setQuantity: editor.setQuantity,
    flush: editor.flush,
  }
}
