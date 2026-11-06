// @pdf-lib/fontkit shapes complex scripts (Arabic, Devanagari and the like)
// with generator code compiled for `regeneratorRuntime`, which it expects as a
// global and never ships. Without it, drawing such text throws
// "regeneratorRuntime is not defined". Import this before fontkit is used.
import 'regenerator-runtime/runtime'
