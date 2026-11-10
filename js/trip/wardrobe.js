/**
 * Гардероб основного проекта (wardrobe-fits) без копий: модель сезонов, данные, проверка цвета и разметка.
 * На GitHub Pages оба проекта живут на одном домене, поэтому модули берутся по относительному пути:
 * /wardrobe-trip/js/trip/ → /wardrobe-fits/js/. Локально рядом должен лежать клон wardrobe-fits.
 * Всё, что капсула знает о вещах и слоях, приходит отсюда; своих правил о сочетаниях у неё нет.
 */
export {SEASONS} from '../../../wardrobe-fits/js/data/seasons.js';
export {buildModel, lookMask} from '../../../wardrobe-fits/js/model.js';
export {evaluateColors} from '../../../wardrobe-fits/js/lib/color.js';
export {formatTemp} from '../../../wardrobe-fits/js/lib/temperature.js';
export {esc} from '../../../wardrobe-fits/js/ui/templates.js';
