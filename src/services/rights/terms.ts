/**
 * Names watched for in an image's text and in what the detectors recognise:
 * major brands, characters, leagues and franchises whose names alone are
 * trademarks. A match holds the image for review rather than blocking it, since
 * a name in text can be fair use or the customer's own licensed product.
 *
 * Deliberately leaves out names that are also everyday words ("Apple",
 * "Champion", "Supreme", "Frozen"), which would flag ordinary text. Admins add
 * their own in the console (RightsRule, kind "term").
 */
export const DEFAULT_WATCH_TERMS = [
  "Nike", "Adidas", "Under Armour", "Reebok", "New Balance", "Converse", "Vans", "The North Face", "Patagonia",
  "Gucci", "Louis Vuitton", "Chanel", "Prada", "Versace", "Balenciaga", "Off-White", "Fendi", "Dior", "Hermès",
  "Burberry", "Givenchy", "Yves Saint Laurent", "Ralph Lauren", "Tommy Hilfiger", "Calvin Klein", "Lacoste",
  "Coca-Cola", "Pepsi", "McDonald's", "Starbucks", "Budweiser", "Red Bull", "Monster Energy", "Harley-Davidson",
  "Ferrari", "Lamborghini", "Porsche", "Mercedes-Benz", "Rolex", "Playboy", "Lego",
  "Disney", "Pixar", "Marvel", "DC Comics", "Star Wars", "Mickey Mouse", "Minnie Mouse", "Winnie the Pooh",
  "Spider-Man", "Batman", "Superman", "Wonder Woman", "Avengers", "Hello Kitty", "Sanrio", "Pokémon", "Pokemon",
  "Pikachu", "Nintendo", "Super Mario", "Zelda", "Sonic the Hedgehog", "Barbie", "Hot Wheels", "Harry Potter",
  "Hogwarts", "SpongeBob", "Nickelodeon", "Looney Tunes", "Bugs Bunny", "Scooby-Doo", "Sesame Street", "Peppa Pig",
  "Paw Patrol", "Bluey", "Minecraft", "Fortnite", "Roblox", "Call of Duty", "Stranger Things", "Care Bears",
  "Teenage Mutant Ninja Turtles", "Transformers", "My Little Pony", "Dragon Ball", "Naruto", "One Piece",
  "NFL", "NBA", "MLB", "NHL", "MLS", "NCAA", "FIFA", "UEFA", "Premier League", "Olympic", "WWE", "UFC", "NASCAR",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The watched names that appear, as whole words, in some text. */
export const termsIn = (text: string, terms: string[]): string[] => {
  if (!text) return [];
  const found = new Set<string>();
  for (const term of terms) {
    const t = term.trim();
    if (t.length < 3) continue;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) found.add(t);
  }
  return [...found];
};
