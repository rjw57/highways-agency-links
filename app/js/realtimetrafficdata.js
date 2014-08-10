// Functions to load data from the network. Provides a single object:
// RealtimeTrafficData.
RealtimeTrafficData = (function() {
'use strict';

var DATA_SERVER = '//trafficdata-realtimetraffic.rhcloud.com/data/';

// Uncomment for testing
// DATA_SERVER = 'http://localhost:5000/data/';

var RealtimeTrafficData = {};

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
RealtimeTrafficData.createFetchDataPromise = function(options) {
  // Fetch links network
  var fetchLinks = createFetchLinksPromise(options);

  // Simplify network
  var simplify = createSimplifyPromise(fetchLinks);

  // Fetch data and munge into a useful form
  var fetchData = createGetJSONPromise(DATA_SERVER + 'traffic_data.json')
  .then(function(data) {
    var rv = {};
    ['speeds', 'flows', 'occupancies'].forEach(function(type) {
      var map = {};
      data.data[type].forEach(function(datum) {
        map[datum.location] = { when: new Date(datum.when), value: datum.value };
      });
      rv[type] = map;
    });
    return { data: rv, metadata: data.metadata, generated: data.generated };
  });

  return Promise.all([fetchLinks, simplify, fetchData])
  .then(function(vs) {
    return {
      graph: vs[0],
      simplified: vs[1],
      data: vs[2].data,
      timestamps: {
        data: {
          published: new Date(vs[2].metadata.publicationtime),
          generated: new Date(vs[2].generated),
        },
      },
    };
  });
}

function createSimplifyPromise(fetchLinks) {
  return fetchLinks
  .then(function(G) {
    // Create networks for various resolutions
    var maxResolution = 30, minResolution, rv = [];

    while(maxResolution < 800) {
      rv.push({
        minResolution: minResolution, maxResolution: maxResolution,
        graph: G,
        tree: graphToTree(G),
      });

      minResolution = maxResolution;
      maxResolution = maxResolution * 3;
      G = G.copy().simplify(30 * minResolution);
    }

    rv.push({
      minResolution: minResolution,
      graph: G,
      tree: graphToTree(G),
    });

    return rv;
  });
}

function inflate(G, dist) {
  // Form an array of node locations and an array of node ids
  var locs = [], ids = [];
  G.getNodes().forEach(function(n) {
    locs.push(n.data.pos); ids.push(n.id);
  });

  var tree = createKDTree(locs),  // Create a kd-tree
      clusters = [],              // List of clusters
      queue = [],                 // Queue of points to check

      // Processed flag for each point
      processed = locs.map(function() { return false; });

  // For each point, P
  for(var pIdx = 0; pIdx < locs.length; pIdx++) {
    // Skip if processed
    if(processed[pIdx]) { continue; }

    // Add P to queue
    queue = [ pIdx ];

    // For each point in queue
    for(var qIdx = 0; qIdx < queue.length; qIdx++) {
      // Search for neighbours dist away from point qIdx
      tree.rnn(locs[queue[qIdx]], dist, function(nIdx) {
        // Has this point been processed? If not, add to queue
        if(!processed[nIdx]) {
          queue.push(nIdx);
          processed[nIdx] = true;
        }
      });
    }
    // queue is new cluster
    clusters.push(queue);
  }
  console.log(locs.length + ' nodes -> ' + clusters.length + ' clusters or max radius ' + dist);

  // Project out each cluster
  clusters.forEach(function(pIdxs) {
    // Calculate centre of mass of cluster
    var com = [0,0];
    pIdxs.forEach(function(pIdx) {
      com[0] += locs[pIdx][0];
      com[1] += locs[pIdx][1];
    });
    com[0] /= pIdxs.length; com[1] /= pIdxs.length;

    // project out
    pIdxs.forEach(function(pIdx) {
      var dx = locs[pIdx][0] - com[0], dy = locs[pIdx][1] - com[1],
          deltaLen = Math.sqrt(dx*dx + dy*dy);

      // Don't touch single-point clusters
      if(deltaLen === 0) { return; }

      var newLoc = [ com[0] + dist*dx/deltaLen, com[1] + dist*dy/deltaLen ];

      if(isNaN(newLoc[0])) {
        console.log(com, dx, dy, deltaLen, newLoc);
      }
      G.getNodeById(ids[pIdx]).data.pos = newLoc;
    });
  });

  return G;
}

function createFetchTrafficDataPromise(type) {
  var url = DATA_SERVER + type + '.json';
  return createGetJSONPromise(url)
  .then(function(data) {
    var rv = {};
    data.data.forEach(function(datum) {
      rv[datum.location] = datum.value;
    });
    return { type: type, url: url, data: rv };
  });
}

function createFetchLinksPromise(options) {
  options = _extend({
    srcProjection: 'EPSG:4326', destProjection: 'EPSG:3857',
  }, options || {});

  return createGetJSONPromise(DATA_SERVER + 'network.json')
  .then(function(network) {
    // A list of node and edge objects to construct the DirectedGraph
    var nodes = [], edges = [];

    // Project each of the nodes into the map co-ordinate projection
    network.graph.nodes.forEach(function(n, nIdx) {
      if(!n.pos) { return; }
      n.pos = ol.proj.transform(n.pos, options.srcProjection, options.destProjection);
      nodes.push({ id: 'Node' + nIdx, data: n });
    });

    // Now, using the projected nodes, work out the length of each edge.
    network.graph.links.forEach(function(e, eIdx) {
      var u = network.graph.nodes[e.source], v = network.graph.nodes[e.target];
      var dx = v.pos[0] - u.pos[0], dy = v.pos[1] - v.pos[1];
      e.length = Math.sqrt(dx*dx + dy*dy);
      edges.push({
        id: 'Edge' + eIdx,
        nodes: [ 'Node' + e.source, 'Node' + e.target ],
        data: e,
      });
    });

    // OK, we've fiddled with the network enough to load it into our network class.
    return new DirectedGraph(nodes, edges);
  });
}

function createGetJSONPromise(url) {
  return new Promise(function(resolve, reject) {
    $.ajax({
      dataType: 'json',
      url: url,
      success: function(data) { resolve(data); },
      error: function(jqXHR, textStatus, errorThrown) { reject(errorThrown); },
    });
  });
}

// utility functions
function graphToTree(graph) {
  var items = [];
  graph.getEdges().forEach(function(edge) {
    var p1 = graph.getNodeById(edge.nodes[0]).data.pos,
        p2 = graph.getNodeById(edge.nodes[1]).data.pos;

    items.push([
      Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]),
      Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1]),
      edge.id,
    ]);
  });

  var tree = rbush();
  tree.load(items);
  return tree;
};

function _extend(obj, otherObj) {
  if(!obj) { return obj; }
  for(var i in otherObj) { obj[i] = otherObj[i]; }
  return obj;
};

return RealtimeTrafficData;
})();
