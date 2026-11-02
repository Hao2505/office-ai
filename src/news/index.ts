// Thời sự (v3): tải RSS báo → lọc an toàn → kho tin cho Director. Xem docs/v3-news.md và SPEC §10.
export {
  USER_AGENT, SUMMARY_MAX, fetchText, fetchFeed, parseRss, parseDate, cleanText, decodeEntities, stripHtml, unwrapCdata,
  summarize, sourceLabel, normalizeUrl, newsId, isFootball, type FetchOptions, type ParseOptions,
} from './feeds.js';
export {
  BLOCKLIST, BLOCK_EXCEPTIONS, PRIVATE_LIFE, SHOWBIZ_PRIVATE, SHOWBIZ_ALLOW, stripDiacritics, normExact, normLoose, normText, matchKeyword,
  findKeyword, findBlocked, isTooOld, isLightShowbiz, judge, filterNews,
  type NormText, type FilterOptions, type Judgement, type DropReason, type Dropped,
} from './filter.js';
export {
  ALL_CATEGORIES, isNewsCategory, expandCategories, sanitizeNewsItem, toNewsRef, NewsStore, getNews, configureNews,
  type NewsStoreOptions, type RefreshReport, type NewsStatus,
} from './store.js';
