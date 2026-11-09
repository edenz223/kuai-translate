/**
 * Where Kuai's player UI is mounted so that it can be clicked. The embedded player
 * draws its controls in a page-level layer over the player element; anything placed
 * inside the player sits beneath that layer. The classic player is its own surface.
 */
export function playerSurface(player:Element,doc:Document):HTMLElement {
  const layer=doc.getElementById('player-controls'),parent=layer?.parentElement;
  return (parent?.contains(player)&&!player.contains(layer!)&&!player.querySelector('.ytp-chrome-bottom')?parent:player) as HTMLElement;
}
