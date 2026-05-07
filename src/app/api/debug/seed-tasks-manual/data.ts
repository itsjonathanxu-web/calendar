// AUTO-GENERATED — see /api/debug/seed-tasks-manual route
export const SEED_TASKS = [
  {
    "uid": "2e659533-7c79-80a6-b676-f6b0f4b4eb96",
    "title": "Learn Cinematic Lighting",
    "start": "2026-05-09",
    "notes": "https://www.udemy.com/course/cinematic-lighting/?couponCode=PMNVD2025\nhttps://www.reilinjoey.com/secretsauce\nhttps://watch.filmmakersacademy.com/"
  },
  {
    "uid": "32359533-7c79-816c-8f1e-f566e21d319e",
    "title": "Reach out to Singapore travel/video creators on LinkedIn for connections",
    "start": "2026-06-30",
    "notes": "5 Coffee Chats during Aug-December"
  },
  {
    "uid": "33859533-7c79-8040-97e9-cb971af73376",
    "title": "Shai Research",
    "start": "2026-05-14",
    "notes": "PG 142 - Pulse Frequency Modulation\nPG 158\n \nEND GOAL\n2x2 nervous knit — Nitinol wires embedded in knitted fabric\nProximity triggered — reacts when a human comes close, becomes \"nervous\"\nBehaviour — fast twitching/pulsing when person is near, slows and softens as they move away\nProf confirmed — agreed to work backwards from this goal. Keep it extremely simple\nNew Nitinol wires received — various thicknesses provided by prof for testing\nMC68HC811E2 — prof shared book chapter on this older chip for colony control. Concept is valid (one master, multiple units) but chip is discontinued. Same architecture applies to Arduino/ESP32 — not worth pursuing this specific chip\nController decision — Arduino or ESP32 confirmed by prof. MSP430 path dropped\nDevelop a schedule of testing/research\nEXISTING PCB MSP430\nPWM already built in — the dial (POT) on the board already controls pulse strength. No modifications needed - Can Reprogram\nLeg pins are mapped — exact wiring of chip pins to each leg is documented. Can Reprogram\nMSP430 is reprogrammable via JTAG pads physically present on the PCB (pins 1, 2, 4, 17–20) using MSP430 LaunchPad (~$15) + Energia or Code Composer Studio\nPOT can be replaced by any sensor — the code reads a value and sets leg speed accordingly. Swap the dial for a proximity sensor and legs respond to a person instead\nENHANCE EXISTING\nMicrocontroller does not need to be on the Stiquito body — can sit off to the side and connect via wires to multiple units for early prototyping\n2 degrees of freedom documented — legs moving forward/back AND up/down via a second Flexinol wire. 14 states in a table in the book\nMSP430 limitations\nMemory — only 4KB flash, 256 bytes RAM. More than enough for leg control, PWM, and speed adjustment — only a limitation if you try to add many sensors or heavy logic on top\nSpeed — slow clock by design (built for low power). Limits how fast it reacts to sensors\nCommunication — no native I2C library, must configure manually in C. No wireless at all\nProgramming — requires C code, LaunchPad hardware, and soldering just to upload anything\nPins — limited free pins. Several already taken by JTAG, LEDs, POT — not enough to individually address each leg without hardware changes\nSwarm scaling — no easy way to chain multiple units. Each needs its own programmer connection\nSensor input — POT is the only input by default. Adding a proximity sensor requires extra wiring and code\nNEXT STEPS\nGet thicker Nitinol wire — order 0.008\" or 0.010\" Flexinol from Dynalloy. Buy a short length to test with\nSet up the bench power supply — connect positive lead to the Nitinol wire terminal on the board, negative lead to GND on the board. Board still gets its normal 3V separately\nStart low, increase slowly — begin at 5V, watch for movement, increase toward 16–17V. Measure how far the leg moves at each step\nRecord displacement at each voltage — note the millimetres of movement so you have data to show your prof\nCompare 0.004\" vs 0.008\" wire — run the same voltage test on both gauges and compare the results side by side\nIf displacement is still not enough — try lengthening the wire before considering coiling\nOnce you have a working wire setup — then buy the LaunchPad and start looking at reprogramming the MSP430 for custom leg sequences\nTODO\nFind out all limitations of existing stiquito \nLook deeper into existing - PCB parts\nPhysical Computing "
  },
  {
    "uid": "33959533-7c79-8163-b54f-f7c4c81d2037",
    "title": "Plan Travel Around SEA",
    "start": "2026-05-16",
    "notes": ""
  },
  {
    "uid": "33c59533-7c79-81cd-bf23-f489e68dca5f",
    "title": "Running Shoes",
    "start": "2026-05-31",
    "notes": "https://therunnersacademy.janeapp.com/locations/the-runner-s-academy-toronto/book\nLook into running shoes "
  },
  {
    "uid": "34359533-7c79-8199-b95e-c55fb117566a",
    "title": "Add Summer Walker + Bruno Mars Setlist",
    "start": "2026-04-15",
    "notes": "🎵 Bruno Mars — The Romantic Tour Setlist (April 10, 2026)\nRisk It All\nCha Cha Cha\nOn My Soul\n24K Magic\nTreasure\nGod Was Showing Off\nI Just Might\nPerm\nWhy You Wanna Fight?\nLow Rider Medley (Oh Girl, Miss You, Everything, Wannabe, That's What I Like)\nSomething Serious\nBlast Off (Silk Sonic)\n777 (Silk Sonic)\nFly As Me (Silk Sonic)\nSmokin Out the Window (Silk Sonic)\nLeave the Door Open (Silk Sonic)\nMarry You\nDie With a Smile\nPiano Medley — It Will Rain / Talking to the Moon / When I Was Your Man\nVersace on the Floor (Saxophone Only)\nLocked Out of Heaven\nJust the Way You Are\nUptown Funk\nDance With Me\n🎵 Summer Walker — Still Finally Over It Tour\nTour kicks off May 26, 2026 in Toronto at Scotiabank Arena — covering the full Over It trilogy (Over It, Still Over It, Finally Over It). Setlist not yet confirmed as tour hasn't started. Based on past tours, expect:\nNo Love\nGirls Need Love\nPlaying Games\nCome Thru\nOver It\nBody\nToxic\nUnloyal\nThrow It Away\nSession 32\nWasted\nConstant Bullshit\nUpdate once tour begins May 26."
  },
  {
    "uid": "34459533-7c79-8110-8987-e2ab37266a40",
    "title": "Fix iPhone Back Glass",
    "start": "2026-05-31",
    "notes": ""
  },
  {
    "uid": "34459533-7c79-816d-a475-e8073d2003cb",
    "title": "Get New iPhone",
    "start": "2026-05-31",
    "notes": ""
  },
  {
    "uid": "34559533-7c79-817e-8f12-ffe5d3ab343c",
    "title": "Check Eyesight",
    "start": "2026-05-23",
    "notes": ""
  },
  {
    "uid": "34c59533-7c79-804f-8c6c-dea216f7981a",
    "title": "Claude Course",
    "start": "2026-05-30",
    "notes": "Claude 101\nClaude Course\nAI Fluency"
  },
  {
    "uid": "34c59533-7c79-8054-a6af-ee30074b7f50",
    "title": "Short Form Content (7)",
    "start": "2026-06-05",
    "notes": ""
  },
  {
    "uid": "34c59533-7c79-808c-95fc-cb176ffb1754",
    "title": "IG Photo (1)",
    "start": "2026-05-19",
    "notes": ""
  },
  {
    "uid": "34c59533-7c79-80a2-8f5e-e2707b5a0eb9",
    "title": "Short Form Content (4)",
    "start": "2026-05-15",
    "notes": ""
  },
  {
    "uid": "34c59533-7c79-80c7-aae3-ce8487be2005",
    "title": "Short Form Content (5)",
    "start": "2026-05-22",
    "notes": ""
  },
  {
    "uid": "34c59533-7c79-80fb-909d-d14bf08c734a",
    "title": "Short Form Content (6)",
    "start": "2026-05-29",
    "notes": ""
  },
  {
    "uid": "34c59533-7c79-80fc-8d00-f47c48e21e86",
    "title": "IG Photo (2)",
    "start": "2026-05-26",
    "notes": ""
  },
  {
    "uid": "34c59533-7c79-816b-a4ce-c5bc61f97ea3",
    "title": "Finish Cleaning Closet",
    "start": "2026-05-31",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-8113-993a-ee7a53e01547",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-07-04",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-811b-b9d5-c908cb8709a4",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-05-23",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-8143-802b-f663feb511bb",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-06-20",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-8152-885c-ca894e1a7368",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-06-13",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-8157-8d72-dfa73a96b95f",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-05-16",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-815b-9335-dd5ac1c64c7f",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-06-27",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-8174-a2c7-d1aa5d69818e",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-05-09",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-8194-bc45-f737a8862c84",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-07-11",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-81ad-996a-ef1899cfe23c",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-06-06",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-81c2-a339-cdebb06adccb",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-05-30",
    "notes": ""
  },
  {
    "uid": "35559533-7c79-81e1-93c9-e9616f852b1a",
    "title": "Watch Chinese Drama 🎬",
    "start": "2026-07-18",
    "notes": ""
  },
  {
    "uid": "35659533-7c79-803c-8ad4-ca9756c8dfc7",
    "title": "BUY CRED",
    "start": "2026-05-17",
    "notes": ""
  },
  {
    "uid": "35659533-7c79-813d-84e0-d6405ce03379",
    "title": "Finalize business plan and content plan for Singapore",
    "start": "2026-05-30",
    "notes": ""
  },
  {
    "uid": "35659533-7c79-81c2-b3dc-c5c4f4cad5f4",
    "title": "Tell Team Lead — Leaving for NUS MDes + Surgery End of May",
    "start": "2026-05-11",
    "notes": "🎓 About the NUS MDes Program\nMaster of Design (Integrated Design) — National University of Singapore\nFocuses on designing at the intersection of technology, human experience and emerging systems\nCore areas: XR and spatial computing, AI-driven interfaces, tangible interaction, systems design\nPractice-based — building and prototyping, not just writing papers\nCross-disciplinary — works alongside engineers, computer scientists, and business students\nSingapore's tech hub position = real industry exposure and network\n18 month program starting August 2026\nDirectly supports transition into AI, XR, and interaction design space\nBuilds on computational and fabrication background from Partisans\n💼 Points to Mention to Team Lead\nGive as much notice as possible — flying out July 24, 2026\nAccepted into NUS Singapore MDes — Integrated Design program starting August\nWant to ensure a smooth and proper transition of all active projects\nSurgery scheduled end of May — will need a few weeks recovery\nGrateful for everything learned at Partisans — formative experience\nHappy to document workflows, hand off files, and brief the team on project status\nAI workflow tools and research can be left as a resource for the studio\nPlan to use remaining vacation days in July before departure\nOpen to staying connected — Partisans has been a huge part of the design journey\n📋 Talking Points — Transition Plan\nIdentify which projects need handoff and to whom\nDocument bespoke millwork files, fabrication notes, and client context\nBrief team on any outstanding fabricator communications\nWrap up rendering and visualization work in progress\nLeave behind AI workflow tools and documentation for studio use"
  },
  {
    "uid": "35759533-7c79-8057-9932-d37b3e8995ab",
    "title": "Find Podcasts",
    "start": "2026-05-09",
    "notes": "Sequioa Summit\nhttps://www.acquired.fm/"
  },
  {
    "uid": "35759533-7c79-80e0-89be-c05480881d91",
    "title": "TORONTO: Storyboarding + Music",
    "start": "2026-05-17",
    "notes": ""
  },
  {
    "uid": "35759533-7c79-80f1-b2f5-df5259cf3dce",
    "title": "Linkedin + X Creators",
    "start": "2026-05-08",
    "notes": ""
  },
  {
    "uid": "35759533-7c79-813f-b7cd-ddd39b9fa7c2",
    "title": "TORONTO: Brainstorm",
    "start": "2026-05-10",
    "notes": ""
  },
  {
    "uid": "35759533-7c79-81f5-a11e-d3013d00477a",
    "title": "Draft Y Combinator Application",
    "start": "2026-11-30",
    "notes": ""
  }
];
