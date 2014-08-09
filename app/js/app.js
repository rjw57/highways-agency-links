(function() {
'use strict';

// ///// CONSTANTS /////

// colour scheme
var LINK_COLOUR = tinycolor({ h: 240, s: 100, v: 75 }).toHexString(),
    SRC_SINK_COLOUR = tinycolor({ h: 0, s: 100, v: 75 }).toHexString();

// Create a promise which gets resolved with an object with the following form:
//  {
//    graph: <DirectedGraph>, // full resolution traffic network
//    simplified: [
//      {
//        minResolution: <Number>?, maxResolution: <Number>?,
//        graph: <DirectedGraph>, tree: <rbush>,
//      },
//    ],
//    data: {
//      speeds: <Object>?,        // map link ids -> speed
//      flows: <Object>?,         // map link ids -> flow
//      occupancies: <Object>?,   // map link ids -> occupancy
//    },
//  }
var fetchData = RealtimeTrafficData.createFetchDataPromise();

fetchData.then(function(v) {
  console.log('fetched data');
  console.log(v);
});

fetchData.catch(function(err) {
  console.log('Error fetching data');
  console.error(err);
});

$(document).ready(function() {
  function stopLoading() { $('body').removeClass('loading'); }
  fetchData.then(stopLoading, stopLoading);

  // Create the base map
  var map = new ol.Map({
    target: 'map',
    // renderer: ['webgl', 'canvas', 'dom'],
    layers: [
      new ol.layer.Tile({
        //source: new ol.source.MapQuest({layer: 'osm'}),
        source: new ol.source.BingMaps({
          key: 'AvsuiJVtmn-zxz7hjF_DnAI7PGecNnzJFsNi7V69yd0BUdWYNlyetZblBtnRUcEI',
          imagerySet: 'Aerial',
          //layer: 'osm'
        }),
      }),
    ],
    view: new ol.View({
      center: ol.proj.transform([-0.09, 51.505], 'EPSG:4326', 'EPSG:3857'),
      zoom: 8,
    }),
  });

  // Once we have data, create the map's postcompose event handler
  fetchData.then(function(data) {
    var cache = {};

    map.on('postcompose', function(event) {
      var vectorContext = event.vectorContext, frameState = event.frameState,
          extent = frameState.extent, res = map.getView().getResolution(), tree, graph,
          spacing = 20*res;

      var imageStyle = new ol.style.Circle({
          radius: 5, snapToPixel: false,
          fill: new ol.style.Fill({color: 'yellow'}),
          stroke: new ol.style.Stroke({color: 'red', width: 1})
      });

      // Do we have this extent cached so we don't need to do a spatial search?
      if(!cache.extent ||
          (extent[0] !== cache.extent[0]) || (extent[1] !== cache.extent[1]) ||
          (extent[2] !== cache.extent[2]) || (extent[3] !== cache.extent[3]))
      {
        cache.extent = extent;
        cache.tree = null; cache.graph = null;

        data.simplified.forEach(function(n) {
          if(n.minResolution && (res < n.minResolution)) { return; }
          if(n.maxResolution && (res > n.maxResolution)) { return; }
          cache.tree = n.tree; cache.graph = n.graph;
        });

        if(!cache.tree || !cache.graph) { return; }
        cache.visibleLinks = cache.tree.search(frameState.extent);
      }

      var pointCoords = [], lineStrings = [];

      cache.visibleLinks.forEach(function(link) {
        var edge = cache.graph.getEdgeById(link[4]),
            p1 = cache.graph.getNodeById(edge.nodes[0]).data.pos,
            p2 = cache.graph.getNodeById(edge.nodes[1]).data.pos,
            delta = [p2[0]-p1[0], p2[1]-p1[1]],
            deltaLen = Math.sqrt(delta[0]*delta[0] + delta[1]*delta[1]),
            unitDelta = [delta[0]/deltaLen, delta[1]/deltaLen],
            lambda, offset;

        var speed = data.data.speeds[edge.data.id],
            occupancy = data.data.occupancies[edge.data.id];

        // Do we have data for this link?
        if((speed === undefined) || (occupancy === undefined)) {
          // no, use line
          lineStrings.push([ p1, p2 ]);
        } else {
          offset = (speed.value / 100) * frameState.time / 1000;
          offset -= Math.floor(offset);
          for(lambda = offset*spacing; lambda < deltaLen; lambda += spacing) {
            pointCoords.push([ p1[0] + unitDelta[0]*lambda, p1[1] + unitDelta[1]*lambda, ]);
          }
          // todo points
        }
      });

      vectorContext.setImageStyle(imageStyle);
      vectorContext.drawMultiPointGeometry(
          new ol.geom.MultiPoint(pointCoords), null);
      vectorContext.setFillStrokeStyle(
        new ol.style.Fill(),
        new ol.style.Stroke({
          color: [255,0,0,1],
          width: 3,
        })
      );
      vectorContext.drawMultiLineStringGeometry(
        new ol.geom.MultiLineString(lineStrings), null);

      map.render();
    });
    map.render();
  });
});

// utility functions

function _extend(obj, otherObj) {
  if(!obj) { return obj; }
  for(var i in otherObj) { obj[i] = otherObj[i]; }
  return obj;
};

})();
