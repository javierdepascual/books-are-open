/* ============================================================
   The menu itself. Shared by the page and the kitchen dashboard so the
   two can never drift apart; the worker keeps its own copy on purpose,
   because the browser is not the authority on the rules.
   ============================================================ */

/* Menu order, because a menu is a real sequence.
   seats: how many parties share the course. A couple counts as one party. */
const COURSES = [
  {
    id: "antipasto", numeral: "I", name: "Antipasto", gloss: "The board", seats: 1,
    pick: "list",
    options: [
      "Salami, prosciutto, cheeses, mozzarella",
      "Olives, roasted peppers, artichokes",
      "Crackers and bread",
    ],
    listLabel: "The whole board",
  },
  {
    id: "pane", numeral: "II", name: "Il Pane", gloss: "Bread and starters", seats: 1,
    pick: "one",
    options: ["Focaccia", "Bruschetta", "Garlic bread", "Breadsticks"],
  },
  {
    id: "primo", numeral: "III", name: "Il Primo", gloss: "Main dish, the pasta", seats: 2,
    pick: "one",
    options: ["Lasagna", "Baked ziti", "Another big pasta dish"],
  },
  {
    id: "secondo", numeral: "IV", name: "Il Secondo", gloss: "Main dish, the meat", seats: 2,
    pick: "one",
    options: ["Meatballs with marinara", "Chicken Parmesan", "Eggplant Parmesan", "Italian sausage and peppers"],
  },
  {
    id: "insalata", numeral: "V", name: "L'Insalata", gloss: "Salad or side", seats: 1,
    pick: "one",
    options: ["Italian chopped salad", "Caprese salad", "Roasted vegetables"],
  },
  {
    id: "dolce", numeral: "VI", name: "Il Dolce", gloss: "Dessert", seats: 1,
    pick: "one",
    options: ["Tiramisu", "Cannoli", "Italian cookies", "Gelato, or another Italian dessert"],
  },
  {
    id: "vino", numeral: "VII", name: "Il Vino", gloss: "The wine", seats: 1,
    pick: "list",
    options: ["Three bottles of red", "One bottle of white, rosé or Prosecco"],
    listLabel: "Four bottles, roughly",
  },
  {
    id: "bibite", numeral: "VIII", name: "Le Bibite", gloss: "Soft drinks and extras", seats: 1,
    pick: "list",
    options: ["Sparkling water", "Italian sodas, regular sodas", "Ice", "Lemons and oranges"],
    listLabel: "The whole run",
  },
];

const MODES = [
  { id: "cooking", label: "I'm cooking it" },
  { id: "buying",  label: "I'm buying it" },
  { id: "money",   label: "Jacky makes it, I chip in" },
];


/* A list course is covered line by line, so its size is its number of
   lines. A cooked course is covered by parties. */
const sizeOf = (c) => (c.pick === "list" ? c.options.length : c.seats);
const BY_ID = Object.fromEntries(COURSES.map((c) => [c.id, c]));
