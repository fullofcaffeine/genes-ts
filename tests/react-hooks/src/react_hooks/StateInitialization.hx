package react_hooks;

import genes.react.State;
import genes.react.React.useState;
import genes.react.React.useStateLazy;
import react_hooks.StateInitializationTypes.Animal;
import react_hooks.StateInitializationTypes.Cat;
import react_hooks.StateInitializationTypes.Choice;
import react_hooks.StateInitializationTypes.Dog;

/** Eager initialization keeps the local's wider `Animal` state type. */
@:genes.reactHook
function useEagerAnimal(makeCat: Void->Cat, dog: Dog): State<Animal> {
  final state: State<Animal> = useState(makeCat());
  state.set(dog);
  return state;
}

/** Lazy initialization keeps the same exact destination-selected type. */
@:genes.reactHook
function useLazyAnimal(makeCat: Void->Cat, dog: Dog): State<Animal> {
  final state: State<Animal> = useStateLazy(() -> makeCat());
  state.set(dog);
  return state;
}

/** An inferred state remains the initializer's narrower `Cat` type. */
@:genes.reactHook
function useNarrowCat(cat: Cat): State<Cat> {
  final state = useState(cat);
  state.set(cat);
  return state;
}

/** The declared enum application closes the parameter absent from `Left`. */
@:genes.reactHook
function useGenericChoice(): State<Choice<Int, String>> {
  final state: State<Choice<Int, String>> = useState(Choice.Left(1));
  state.set(Choice.Right("ready"));
  return state;
}

/** Roots the module functions without calling Hooks outside React. */
function retainStateInitializationProof(): Bool {
  return useEagerAnimal != null
    && useLazyAnimal != null
    && useNarrowCat != null
    && useGenericChoice != null;
}
