// Load order for the game's classic scripts. Used by the build and the headless tests.
module.exports = {
  core: [
    'js/core/util.js', 'js/core/physics.js', 'js/core/data.js', 'js/core/content.js', 'js/core/sim.js', 'js/core/plant.js',
    'js/core/rack.js', 'js/core/rail.js', 'js/core/crew.js', 'js/core/permits.js', 'js/core/events.js', 'js/core/report.js',
  ],
  ui: ['js/ui/dom.js', 'js/ui/svg.js', 'js/ui/views-ops.js', 'js/ui/views-safety.js', 'js/ui/app.js'],
  css: ['css/hmi.css'],
};
