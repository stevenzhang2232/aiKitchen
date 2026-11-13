import type { Category, Location, Unit } from '@kitchen/core';

export interface CatalogEntry {
  key: string;
  name: string;
  category: Category;
  unit: Unit;
  location: Location;
  aliases: string[];
  pieceGrams?: number;
  /** Image file name in web/public/foods (without extension). Similar foods may share one. */
  image?: string;
  /** Shown as a quick pick during onboarding. */
  common?: boolean;
}

function e(
  key: string,
  name: string,
  category: Category,
  unit: Unit,
  location: Location,
  aliases: string[],
  extra: Partial<CatalogEntry> = {},
): CatalogEntry {
  return { key, name, category, unit, location, aliases, image: key, ...extra };
}

export const CATALOG: CatalogEntry[] = [
  // Vegetables
  e('tomato', 'Tomato', 'vegetable', 'pcs', 'fridge', ['tomatoes', '番茄', '西红柿'], { pieceGrams: 150, common: true }),
  e('potato', 'Potato', 'vegetable', 'pcs', 'pantry', ['potatoes', '土豆', '马铃薯'], { pieceGrams: 200, common: true }),
  e('carrot', 'Carrot', 'vegetable', 'pcs', 'fridge', ['carrots', '胡萝卜'], { pieceGrams: 120, common: true }),
  e('onion', 'Onion', 'vegetable', 'pcs', 'pantry', ['onions', 'yellow onion', 'red onion', '洋葱'], { pieceGrams: 150, common: true }),
  e('cucumber', 'Cucumber', 'vegetable', 'pcs', 'fridge', ['cucumbers', '黄瓜'], { pieceGrams: 250, common: true }),
  e('eggplant', 'Eggplant', 'vegetable', 'pcs', 'fridge', ['aubergine', 'eggplants', '茄子'], { pieceGrams: 250 }),
  e('napa_cabbage', 'Napa cabbage', 'vegetable', 'pcs', 'fridge', ['chinese cabbage', 'napa', '大白菜', '白菜'], { pieceGrams: 1500 }),
  e('cabbage', 'Cabbage', 'vegetable', 'pcs', 'fridge', ['green cabbage', '卷心菜', '包菜', '圆白菜'], { pieceGrams: 1000 }),
  e('broccoli', 'Broccoli', 'vegetable', 'pcs', 'fridge', ['西兰花', '西蓝花'], { pieceGrams: 350, common: true }),
  e('cauliflower', 'Cauliflower', 'vegetable', 'pcs', 'fridge', ['花菜', '菜花'], { pieceGrams: 600 }),
  e('bell_pepper', 'Bell pepper', 'vegetable', 'pcs', 'fridge', ['capsicum', 'green pepper', 'red pepper', 'sweet pepper', '青椒', '彩椒', '甜椒'], { pieceGrams: 150 }),
  e('chili_pepper', 'Chili pepper', 'vegetable', 'pcs', 'fridge', ['chili', 'chilli', 'hot pepper', 'fresh chili', '辣椒', '小米辣'], { pieceGrams: 10 }),
  e('spinach', 'Spinach', 'vegetable', 'g', 'fridge', ['菠菜'], { image: 'leafy_greens' }),
  e('lettuce', 'Lettuce', 'vegetable', 'pcs', 'fridge', ['生菜', 'romaine'], { pieceGrams: 400 }),
  e('bok_choy', 'Bok choy', 'vegetable', 'g', 'fridge', ['pak choi', '青菜', '小白菜', '上海青'], { image: 'leafy_greens' }),
  e('celery', 'Celery', 'vegetable', 'g', 'fridge', ['芹菜']),
  e('zucchini', 'Zucchini', 'vegetable', 'pcs', 'fridge', ['courgette', '西葫芦'], { pieceGrams: 250 }),
  e('pumpkin', 'Pumpkin', 'vegetable', 'g', 'pantry', ['squash', '南瓜']),
  e('corn', 'Corn', 'vegetable', 'pcs', 'fridge', ['sweet corn', 'corn cob', '玉米'], { pieceGrams: 250 }),
  e('green_beans', 'Green beans', 'vegetable', 'g', 'fridge', ['string beans', '四季豆', '豆角']),
  e('sweet_potato', 'Sweet potato', 'vegetable', 'pcs', 'pantry', ['sweet potatoes', 'yam', '红薯', '地瓜'], { pieceGrams: 250 }),
  e('daikon', 'Daikon radish', 'vegetable', 'pcs', 'fridge', ['daikon', 'white radish', 'radish', '白萝卜', '萝卜'], { pieceGrams: 800 }),
  e('bean_sprouts', 'Bean sprouts', 'vegetable', 'g', 'fridge', ['mung bean sprouts', '豆芽', '绿豆芽']),
  e('lotus_root', 'Lotus root', 'vegetable', 'g', 'fridge', ['莲藕', '藕']),
  e('asparagus', 'Asparagus', 'vegetable', 'g', 'fridge', ['芦笋']),

  // Mushrooms
  e('shiitake', 'Shiitake mushroom', 'mushroom', 'g', 'fridge', ['shiitake', 'shiitake mushrooms', '香菇'], { image: 'mushroom' }),
  e('button_mushroom', 'Button mushroom', 'mushroom', 'g', 'fridge', ['mushroom', 'mushrooms', 'white mushroom', '口蘑', '蘑菇'], { image: 'mushroom' }),
  e('enoki', 'Enoki mushroom', 'mushroom', 'g', 'fridge', ['enoki', '金针菇']),
  e('wood_ear', 'Wood ear mushroom', 'mushroom', 'g', 'pantry', ['wood ear', 'black fungus', '木耳', '黑木耳']),

  // Aromatics
  e('scallion', 'Scallion', 'aromatic', 'pcs', 'fridge', ['green onion', 'spring onion', 'scallions', '葱', '小葱', '大葱'], { pieceGrams: 15, common: true }),
  e('ginger', 'Ginger', 'aromatic', 'g', 'fridge', ['姜', '生姜']),
  e('garlic', 'Garlic', 'aromatic', 'pcs', 'pantry', ['garlic clove', 'garlic cloves', '大蒜', '蒜'], { pieceGrams: 5 }),
  e('cilantro', 'Cilantro', 'aromatic', 'g', 'fridge', ['coriander', 'coriander leaves', '香菜']),

  // Fruit
  e('apple', 'Apple', 'fruit', 'pcs', 'fridge', ['apples', '苹果'], { pieceGrams: 200, common: true }),
  e('banana', 'Banana', 'fruit', 'pcs', 'pantry', ['bananas', '香蕉'], { pieceGrams: 120 }),
  e('orange', 'Orange', 'fruit', 'pcs', 'fridge', ['oranges', '橙子', '橘子'], { pieceGrams: 180 }),
  e('lemon', 'Lemon', 'fruit', 'pcs', 'fridge', ['lemons', '柠檬'], { pieceGrams: 100 }),
  e('strawberry', 'Strawberry', 'fruit', 'g', 'fridge', ['strawberries', '草莓']),
  e('grape', 'Grape', 'fruit', 'g', 'fridge', ['grapes', '葡萄']),
  e('pear', 'Pear', 'fruit', 'pcs', 'fridge', ['pears', '梨'], { pieceGrams: 200 }),
  e('mango', 'Mango', 'fruit', 'pcs', 'fridge', ['mangoes', '芒果'], { pieceGrams: 300 }),
  e('kiwi', 'Kiwi', 'fruit', 'pcs', 'fridge', ['kiwifruit', '猕猴桃', '奇异果'], { pieceGrams: 80 }),
  e('watermelon', 'Watermelon', 'fruit', 'g', 'fridge', ['西瓜']),

  // Meat
  e('pork', 'Pork', 'meat', 'g', 'fridge', ['pork loin', 'lean pork', '猪肉', '瘦肉'], { common: true }),
  e('pork_belly', 'Pork belly', 'meat', 'g', 'fridge', ['五花肉'], { image: 'pork' }),
  e('pork_ribs', 'Pork ribs', 'meat', 'g', 'freezer', ['spare ribs', 'ribs', '排骨', '猪排骨']),
  e('ground_pork', 'Ground pork', 'meat', 'g', 'fridge', ['minced pork', 'pork mince', '猪肉末', '肉末', '肉馅'], { image: 'ground_meat' }),
  e('beef', 'Beef', 'meat', 'g', 'fridge', ['beef steak', 'beef slices', '牛肉'], { common: true }),
  e('ground_beef', 'Ground beef', 'meat', 'g', 'fridge', ['minced beef', 'beef mince', '牛肉末', '牛肉馅'], { image: 'ground_meat' }),
  e('chicken_breast', 'Chicken breast', 'meat', 'g', 'fridge', ['chicken breasts', '鸡胸肉', '鸡胸'], { common: true }),
  e('chicken_thigh', 'Chicken thigh', 'meat', 'g', 'fridge', ['chicken thighs', 'chicken leg', '鸡腿', '鸡腿肉']),
  e('chicken_wings', 'Chicken wings', 'meat', 'g', 'fridge', ['chicken wing', '鸡翅', '鸡翅中']),
  e('lamb', 'Lamb', 'meat', 'g', 'fridge', ['mutton', '羊肉']),
  e('bacon', 'Bacon', 'meat', 'g', 'fridge', ['培根']),
  e('ham', 'Ham', 'meat', 'g', 'fridge', ['火腿']),
  e('sausage', 'Sausage', 'meat', 'pcs', 'fridge', ['sausages', 'chinese sausage', '香肠', '腊肠', '火腿肠'], { pieceGrams: 50 }),

  // Seafood
  e('shrimp', 'Shrimp', 'seafood', 'g', 'freezer', ['prawn', 'prawns', '虾', '虾仁']),
  e('fish', 'Fish', 'seafood', 'g', 'fridge', ['fish fillet', 'whole fish', '鱼', '鱼片']),
  e('salmon', 'Salmon', 'seafood', 'g', 'fridge', ['三文鱼', '鲑鱼']),
  e('squid', 'Squid', 'seafood', 'g', 'freezer', ['calamari', '鱿鱼']),
  e('clams', 'Clams', 'seafood', 'g', 'fridge', ['clam', '蛤蜊', '花甲']),

  // Eggs and dairy
  e('egg', 'Egg', 'egg_dairy', 'pcs', 'fridge', ['eggs', '鸡蛋', '蛋'], { pieceGrams: 50, common: true }),
  e('milk', 'Milk', 'egg_dairy', 'pcs', 'fridge', ['牛奶'], { pieceGrams: 250, common: true }),
  e('yogurt', 'Yogurt', 'egg_dairy', 'pcs', 'fridge', ['yoghurt', '酸奶'], { pieceGrams: 150 }),
  e('cheese', 'Cheese', 'egg_dairy', 'g', 'fridge', ['cheddar', 'mozzarella', '奶酪', '芝士']),
  e('butter', 'Butter', 'egg_dairy', 'g', 'fridge', ['黄油']),

  // Staples
  e('rice', 'Rice', 'staple', 'kg', 'pantry', ['white rice', '大米', '米'], { common: true }),
  e('noodles', 'Noodles', 'staple', 'g', 'pantry', ['wheat noodles', 'egg noodles', '面条', '挂面'], { common: true }),
  e('rice_noodles', 'Rice noodles', 'staple', 'g', 'pantry', ['rice vermicelli', 'vermicelli', '米粉', '米线']),
  e('pasta', 'Pasta', 'staple', 'g', 'pantry', ['spaghetti', 'penne', '意大利面', '意面']),
  e('bread', 'Bread', 'staple', 'serving', 'pantry', ['toast', 'loaf', 'bread slices', '面包', '吐司'], { common: true }),
  e('flour', 'Flour', 'staple', 'kg', 'pantry', ['wheat flour', 'all purpose flour', '面粉']),
  e('dumplings', 'Frozen dumplings', 'staple', 'serving', 'freezer', ['dumplings', 'jiaozi', '饺子', '速冻饺子']),
  e('oats', 'Oats', 'staple', 'g', 'pantry', ['oatmeal', 'rolled oats', '燕麦']),

  // Tofu, beans and nuts
  e('tofu', 'Tofu', 'tofu_bean', 'pcs', 'fridge', ['bean curd', 'firm tofu', 'soft tofu', 'silken tofu', '豆腐'], { pieceGrams: 350, common: true }),
  e('dried_tofu', 'Dried tofu', 'tofu_bean', 'g', 'fridge', ['pressed tofu', '豆干', '豆腐干']),
  e('peanut', 'Peanuts', 'tofu_bean', 'g', 'pantry', ['peanut', '花生', '花生米']),
  e('edamame', 'Edamame', 'tofu_bean', 'g', 'freezer', ['soybeans', '毛豆']),

  // Seasonings (tracked as have / don't have)
  e('oil', 'Oil', 'seasoning', 'pcs', 'pantry', ['cooking oil', 'vegetable oil', 'peanut oil', '食用油', '油']),
  e('salt', 'Salt', 'seasoning', 'pcs', 'pantry', ['盐', '食盐']),
  e('sugar', 'Sugar', 'seasoning', 'pcs', 'pantry', ['white sugar', 'rock sugar', '糖', '白糖', '冰糖']),
  e('light_soy', 'Light soy sauce', 'seasoning', 'pcs', 'pantry', ['soy sauce', 'light soy', '生抽', '酱油']),
  e('dark_soy', 'Dark soy sauce', 'seasoning', 'pcs', 'pantry', ['dark soy', '老抽']),
  e('vinegar', 'Vinegar', 'seasoning', 'pcs', 'pantry', ['rice vinegar', 'black vinegar', 'white vinegar', '醋', '陈醋', '香醋']),
  e('cooking_wine', 'Cooking wine', 'seasoning', 'pcs', 'pantry', ['shaoxing wine', 'rice wine', '料酒', '黄酒']),
  e('oyster_sauce', 'Oyster sauce', 'seasoning', 'pcs', 'fridge', ['蚝油']),
  e('sesame_oil', 'Sesame oil', 'seasoning', 'pcs', 'pantry', ['香油', '芝麻油']),
  e('black_pepper', 'Black pepper', 'seasoning', 'pcs', 'pantry', ['ground pepper', 'white pepper', '胡椒粉', '黑胡椒', '白胡椒']),
  e('chili_oil', 'Chili oil', 'seasoning', 'pcs', 'pantry', ['chilli oil', '辣椒油', '红油']),
  e('dried_chili', 'Dried chili', 'seasoning', 'pcs', 'pantry', ['dried chilies', 'dried chilli', 'dried chili peppers', 'chili flakes', '干辣椒', '辣椒面']),
  e('starch', 'Starch', 'seasoning', 'pcs', 'pantry', ['cornstarch', 'corn starch', 'potato starch', 'cornflour', '淀粉', '生粉']),
  e('chicken_bouillon', 'Chicken bouillon', 'seasoning', 'pcs', 'pantry', ['chicken powder', 'chicken stock powder', 'msg', '鸡精', '味精']),
  e('ketchup', 'Ketchup', 'seasoning', 'pcs', 'fridge', ['tomato ketchup', 'tomato sauce', '番茄酱']),
  e('doubanjiang', 'Chili bean paste', 'seasoning', 'pcs', 'pantry', ['doubanjiang', 'broad bean paste', '豆瓣酱']),
  e('sichuan_pepper', 'Sichuan peppercorn', 'seasoning', 'pcs', 'pantry', ['sichuan pepper', 'sichuan peppercorns', '花椒']),
  e('star_anise', 'Star anise', 'seasoning', 'pcs', 'pantry', ['八角', '大料']),
  e('fish_sauce', 'Fish sauce', 'seasoning', 'pcs', 'pantry', ['鱼露']),
  e('honey', 'Honey', 'seasoning', 'pcs', 'pantry', ['蜂蜜']),
  e('sesame_seeds', 'Sesame seeds', 'seasoning', 'pcs', 'pantry', ['芝麻']),
];

for (const entry of CATALOG) {
  if (entry.category === 'seasoning') entry.image = undefined;
}

/** Seasonings added by "Add seasoning pack" until the user edits the pack. */
export const DEFAULT_SEASONING_PACK = ['oil', 'salt', 'sugar', 'light_soy', 'dark_soy', 'vinegar'];
