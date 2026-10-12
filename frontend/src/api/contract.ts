/**
 * The hand-written API types in this folder must match the server's OpenAPI spec exactly
 * (M10). `schema.d.ts` is generated from `docs/openapi.json` (`npm run api:types`); every
 * line below is a compile-time assertion that one of our types is structurally identical to
 * the matching schema.
 *
 * A backend change that renames a field, or makes one nullable, now fails `npm run typecheck`
 * instead of surfacing as `undefined` in the browser.
 *
 * Nothing here exists at runtime - these are types only.
 */
import type { Address } from './addresses'
import type { AdminCategory, AdminProduct, AdminSummary, Coupon, StockLedger } from './admin'
import type { TokenResponse, User } from './auth'
import type { Cart, CartLine, MergeReport } from './cart'
import type { Category, ProductDetail, ProductPage, ProductSummary } from './catalog'
import type { Health } from './health'
import type { AppliedCoupon, Order, OrderSummary, Quote } from './orders'
import type { AdminReturn, ReturnRequest } from './returns'
import type { MyReview, Review, ReviewPage } from './reviews'
import type { components } from './schema'
import type { Wishlist } from './wishlist'

type Schemas = components['schemas']

/** Fails to compile unless A and B are the same type in both directions. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T

// --- Accounts -------------------------------------------------------------------------------
export type _User = Expect<Exact<User, Schemas['UserOut']>>
export type _Token = Expect<Exact<TokenResponse, Schemas['TokenOut']>>
export type _Address = Expect<Exact<Address, Schemas['AddressOut']>>

// --- Catalog --------------------------------------------------------------------------------
export type _Category = Expect<Exact<Category, Schemas['CategoryOut']>>
export type _ProductSummary = Expect<Exact<ProductSummary, Schemas['ProductSummary']>>
export type _ProductDetail = Expect<Exact<ProductDetail, Schemas['ProductDetail']>>
export type _ProductPage = Expect<Exact<ProductPage, Schemas['ProductPage']>>
export type _Health = Expect<Exact<Health, Schemas['HealthResponse']>>

// --- Cart and checkout ----------------------------------------------------------------------
export type _CartLine = Expect<Exact<CartLine, Schemas['CartLineOut']>>
export type _Cart = Expect<Exact<Cart, Schemas['CartOut']>>
export type _MergeReport = Expect<Exact<MergeReport, Schemas['MergeReport']>>
export type _Quote = Expect<Exact<Quote, Schemas['QuoteOut']>>
export type _AppliedCoupon = Expect<Exact<AppliedCoupon, Schemas['AppliedCoupon']>>
export type _Order = Expect<Exact<Order, Schemas['OrderOut']>>
export type _OrderSummary = Expect<Exact<OrderSummary, Schemas['OrderSummary']>>

// --- Phase 2 --------------------------------------------------------------------------------
export type _Review = Expect<Exact<Review, Schemas['ReviewOut']>>
export type _ReviewPage = Expect<Exact<ReviewPage, Schemas['ReviewPage']>>
export type _MyReview = Expect<Exact<MyReview, Schemas['MyReview']>>
export type _Wishlist = Expect<Exact<Wishlist, Schemas['WishlistOut']>>
export type _Return = Expect<Exact<ReturnRequest, Schemas['ReturnOut']>>

// --- Back office ----------------------------------------------------------------------------
export type _AdminProduct = Expect<Exact<AdminProduct, Schemas['AdminProductOut']>>
export type _AdminCategory = Expect<Exact<AdminCategory, Schemas['AdminCategoryOut']>>
export type _AdminSummary = Expect<Exact<AdminSummary, Schemas['AdminSummary']>>
export type _StockLedger = Expect<Exact<StockLedger, Schemas['StockLedger']>>
export type _Coupon = Expect<Exact<Coupon, Schemas['CouponOut']>>
export type _AdminReturn = Expect<Exact<AdminReturn, Schemas['AdminReturnOut']>>
