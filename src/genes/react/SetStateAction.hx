package genes.react;

import haxe.extern.EitherType;

/** Faithful React replacement-or-updater union. */
typedef SetStateAction<State> = EitherType<State, State->State>;
