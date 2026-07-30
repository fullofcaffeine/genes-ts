package module_functions;

import module_functions.TopLevelCollisionSource.collisionName as importedCollisionName;

/**
 * This ordinary Haxe module field becomes a top-level JavaScript export named
 * `collisionName`. The imported direct function therefore needs a local alias;
 * two declarations with that name would be invalid JavaScript and TypeScript.
 */
function collisionName(): String {
  return "local";
}

function collisionTranscript(): String {
  return '${collisionName()}:${importedCollisionName()}';
}
