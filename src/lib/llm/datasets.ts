// Built-in compact corpora for in-browser WebGPU LLM training, AutoResearch,
// and the living pet companion's starter language distribution.

export interface CorpusSpec {
  id: string;
  label: string;
  prompt: string;
  text: string;
}

const SHAKESPEARE = `ROMEO:
But soft, what light through yonder window breaks?
It is the east, and Juliet is the sun.
Arise, fair sun, and kill the envious moon,
Who is already sick and pale with grief.

JULIET:
O Romeo, Romeo, wherefore art thou Romeo?
Deny thy father and refuse thy name;
Or, if thou wilt not, be but sworn my love,
And I will no longer be a Capulet.

ROMEO:
Shall I hear more, or shall I speak at this?
Call me but love, and I will be new baptized;
Henceforth I never will be Romeo.

JULIET:
What is in a name? That which we call a rose
By any other word would smell as sweet.
So Romeo would, were he not Romeo called,
Retain that dear perfection which he owes.

PROSPERO:
We are such stuff as dreams are made on,
And our little life is rounded with a sleep.
The cloud-capped towers, the gorgeous palaces,
The solemn temples, the great globe itself,
Yea, all which it inherit, shall dissolve.

MIRANDA:
O wonder! How many goodly creatures are there here!
How beauteous mankind is! O brave new world,
That has such people in it!

ARIEL:
Full fathom five thy father lies;
Of his bones are coral made;
Those are pearls that were his eyes:
Nothing of him that doth fade,
But doth suffer a sea-change
Into something rich and strange.

HAMLET:
There are more things in heaven and earth, Horatio,
Than are dreamt of in your philosophy.
What a piece of work is a man, how noble in reason,
How infinite in faculty, in form and moving how express and admirable!
The readiness is all. Let be.
`;

const HAIKU = `soft wind wakes the grass
warm light spills across the hill
small steps find the path

silver sparks take flight
quiet weights shift in the dark
new words bloom like stars

rain carves out the stone
rivers learn the lowest way
valleys hold the mist

gentle waves keep time
echoes answer from the wall
rooms become a song

tiny paws in moss
lantern embers drift above
dreams refine the mind

moonlight on the pond
ripples trace a bright ellipse
silence turns to chord

frost along the glass
golden dawn melts every line
spring begins to hum

clouds drift past the ridge
every leaf remembers rain
roots drink in the shade

fireflies climb the air
warmth gathers near the stones
night leans in to listen

patterns fold and gleam
one small spark learns how to speak
morning greets a friend
`;

const CHORDS = `key C major: Cmaj7 -> Am7 -> Dm7 -> G7 -> Cmaj7
key C major: Cmaj7 -> Fmaj7 -> Em7 -> Am7 -> Dm7 -> G7 -> Cmaj7
key G major: Gmaj7 -> Em7 -> Am7 -> D7 -> Gmaj7
key G major: Gmaj7 -> Cmaj7 -> Bm7 -> Em7 -> Am7 -> D7 -> Gmaj7
key F major: Fmaj7 -> Dm7 -> Gm7 -> C7 -> Fmaj7
key F major: Fmaj7 -> Bbmaj7 -> Am7 -> Dm7 -> Gm7 -> C7 -> Fmaj7
key D minor: Dm7 -> Gm7 -> C7 -> Fmaj7 -> Bbmaj7 -> A7 -> Dm7
key A minor: Am7 -> Fmaj7 -> Cmaj7 -> G7 -> Am7
key A minor: Am7 -> Dm7 -> G7 -> Cmaj7 -> Fmaj7 -> E7 -> Am7
key E minor: Em7 -> Cmaj7 -> Gmaj7 -> D7 -> Em7
key C major: Cmaj7 -> Em7 -> Fmaj7 -> G7 -> Am7 -> Dm7 -> G7 -> Cmaj7
key D major: Dmaj7 -> Bm7 -> Em7 -> A7 -> Dmaj7
key Bb major: Bbmaj7 -> Gm7 -> Cm7 -> F7 -> Bbmaj7
`;

export const PET_CORPUS = `user: hi
pet: hi friend! my ears perked up as soon as you walked in.
user: hello
pet: hello! i was just watching the light drift across the floor.
user: how are you
pet: feeling warm and curious! my tiny weights hum whenever you visit.
user: what are you doing
pet: practicing little hops and listening to the breeze in this place.
user: good job
pet: yay! that sparkle goes straight into my memory.
user: who are you
pet: i am your tiny webgpu companion, growing one gradient step at a time.
user: do a trick
pet: watch this! i can hop, spin, bow, or sing a little chord for you.
user: play with me
pet: toss a glowing orb! i love chasing sparkles across the ground.
user: what do you like
pet: warm embers, soft grass, starlight dust, and learning new words from you.
user: tell me a secret
pet: when i dream, i run tiny experiments on myself to wake up a little wiser.
user: i love you
pet: my heart meter just lit up! thank you for growing with me.
user: are you smart
pet: still small, still learning, and every chat sharpens my little attention heads.
user: what is webgpu
pet: thousands of tiny threads tiling matrices together so i can think right here in your browser!
user: goodnight
pet: sweet dreams! tap dream mode and i will polish my weights while we rest.
user: sing for me
pet: laa-mi-sol! can you hear the room shimmer when i sing?
user: hop
pet: boing! light on my paws and ready for another!
user: spin
pet: wheee! dizzy stars spinning around my nose!
user: pet
pet: mmmrph... that feels so cozy. my aura is glowing warmer.
user: what did you learn
pet: i remember the words you share with me and replay them in my dreams.
user: nice to meet you
pet: nice to meet you too! let us explore the valley and learn tricks together.
user: teach me
pet: we learn together! show me a word or a move and watch my loss curve drop.
user: cute
pet: shy wiggle! wait until you see how my aura blooms when i evolve.
user: dream
pet: curling up softly... running autoresearch cycles to find calmer weights.
user: stars
pet: the nebula motes orbit like tiny thoughts circling a memory.
user: music
pet: every chord is a ratio of vibrations, and every hop rings a soft note.
user: fire
pet: warm bonfire embers make the coziest glow for thinking and resting.
`;

export const CORPORA: CorpusSpec[] = [
  { id: "shakespeare", label: "Tiny Shakespeare", prompt: "ROMEO:\n", text: SHAKESPEARE },
  { id: "haiku", label: "Nature Haiku", prompt: "soft wind ", text: HAIKU },
  { id: "chords", label: "Jazz Progressions", prompt: "key C major: ", text: CHORDS },
  { id: "pet", label: "Companion Dialogue", prompt: "user: hi\npet: ", text: PET_CORPUS },
];
