$(document).ready(function() {
  // create our leaflet map
  var map = L.map('map', {
    attributionControl: false,
  }).setView([51.505, -0.09], 13);

  // add attribuion control
  L.control.attribution({ prefix: false }).addTo(map);

  // add scale
  L.control.scale().addTo(map);

  // use OSM base layer
  var baseMap = L.tileLayer('//otile{s}-s.mqcdn.com/tiles/1.0.0/map/{z}/{x}/{y}.jpg', {
    subdomains: '1234',
    attribution: '© OpenStreetMap contributors',
    opacity: 0.5,
  }).addTo(map);

  // kick off a request for our data
  $.getJSON('links.json', function(data) {
    // add our GeoJSON layers

    // first the actual links
    var linksLayer = L.geoJson(data, {
      filter: function(feature, layer) {
        var props = feature.properties;
        return props._type === 'edge' && props._edgetype === 'link';
      },
      color: tinycolor({ h: 240, s: 75, v: 75 }).toHexString(),
      weight: 5,
      opacity: 1,
    }).addTo(map);

    // then sources and sinks
    var sourcesAndSinksLayer = L.geoJson(data, {
      filter: function(feature, layer) {
        var props = feature.properties;
        return props._type === 'edge' && props._edgetype !== 'link';
      },
      color: tinycolor({ h: 0, s: 75, v: 75 }).toHexString(),
      weight: 3,
      opacity: 1,
    });

    // zoom to extent of links
    map.fitBounds(linksLayer.getBounds(), { padding: [10,10] });

    // add layer control
    L.control.layers(null, {
      'Links': linksLayer,
      'Sources and sinks': sourcesAndSinksLayer,
    }, {
      autoZIndex: true,
    }).addTo(map);

    // clear loading
    $('body').removeClass('loading');
  });
});

