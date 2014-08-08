DirectedGraph = (function() {
'use strict';

// utility functions
var _extend = function (obj, otherObj) {
  if(!obj) { return obj; }
  for(var i in otherObj) { obj[i] = otherObj[i]; }
  return obj;
};

// Create a directed graph from an array of nodes and edges. Each node should
// be an object of the following form: { id: <String>, data: <Object>? }. Each
// edge should be an object of the following form:
//    { id: <String>, nodes: [<String>, <String>], data: <Object>? }
// where "nodes" is an ordered pair of node ids.
var DirectedGraph = function(nodes, edges) {
  var self = this;

  // A map of {node,edge} id to {node,edge} object
  self.nodeMap = {};
  self.edgeMap = {};

  // A map from node id to objects, one for each node. Each element is an
  // object with the following form: { in: <Array>?, out: <Array>? }. If
  // present, in is an array of "in" edge indices and out is an array of "out"
  // edge ids.
  self._node_edges = [];

  // Cache of number of nodes (order) and number of edges (size)
  self.order = 0;
  self.size = 0;

  // Add all nodes. (Doing so first avoids an implicit add on the edges.)
  nodes.forEach(function(obj) { self.addNode(obj); });

  // Add all edges
  edges.forEach(function(obj) { self.addEdge(obj); });
};

// Return an array of all node objects in the graph
DirectedGraph.prototype.getNodes = function() {
  var nodes = [];
  for(var k in this.nodeMap) { nodes.push(this.nodeMap[k]); }
  return nodes;
};

// Return an array of all edge objects in the graph
DirectedGraph.prototype.getEdges = function() {
  var edges = [];
  for(var k in this.edgeMap) { edges.push(this.edgeMap[k]); }
  return edges;
};

// Return a deep copy of the graph. Note that the node and edge *data* objects
// are not deep copied.
DirectedGraph.prototype.copy = function() {
  var newNodes = [], newEdges = [];
  this.getNodes().forEach(function(node) {
    newNodes.push({
      id: node.id, data: node.data,
    });
  });
  this.getEdges().forEach(function(edge) {
    newEdges.push({
      id: edge.id, data: edge.data, nodes: edge.nodes,
    });
  });
  return new DirectedGraph(newNodes, newEdges);
};

// Return true iff this graph contains a node with id nodeId
DirectedGraph.prototype.hasNodeId = function(nodeId) {
  return !!(this.nodeMap[nodeId]);
};

// Return true iff this graph contains a edge with id edgeId
DirectedGraph.prototype.hasEdgeId = function(edgeId) {
  return !!(this.edgeMap[edgeId]);
};

// Add a node object to the graph. If a node with a matching id
// already exists in the graph, it is replaced.
DirectedGraph.prototype.addNode = function(node) {
  if(!this.hasNodeId(node.id)) {
    this._node_edges[node.id] = { in: [], out: [] };
    this.order++;
  }
  this.nodeMap[node.id] = node;
};

// Add an edge object to the graph. If the node ids it references do not exist,
// they are implicitly created. If there is already an edge with a matching id,
// it is replaced.
DirectedGraph.prototype.addEdge = function(edge) {
  var self = this, outNodeIdx, inNodeIdx, edgeIdx;

  // ensure nodes are present
  edge.nodes.forEach(function(n) {
    if(!self.hasNodeId(n)) {
      console.warn('Implicitly adding node ' + n);
      self.addNode({ id: n });
    }
  });

  if(this.hasEdgeId(edge.id)) {
    // remove references to the old edge from the node edge map
    var oldEdge = this.getEdgeById(edge.id),
        outCache = this._node_edges[oldEdge.nodes[0]].out,
        inCache = this._node_edges[oldEdge.nodes[1]].in;

    outCache.splice(outCache.indexOf(edge.id), 1);
    inCache.splice(inCache.indexOf(edge.id), 1);
  } else {
    this.size++;
  }

  this.edgeMap[edge.id] = edge;

  // update our cache of in and out edges
  this._node_edges[edge.nodes[0]].out.push(edge.id);
  this._node_edges[edge.nodes[1]].in.push(edge.id);
};

// Remove the edge with id edgeId. Throws if the edge is not in the graph. This
// does not remove any nodes.
DirectedGraph.prototype.removeEdge = function(edgeId) {
  var edge = this.edgeMap[edgeId];
  if(!edge) {
    throw new Error('Edge id ' + edgeId + ' is not in the graph.');
  }

  // Remove edge from edge map
  delete this.edgeMap[edgeId];
  this.size--;

  // Remove edge from in and out node edge cache
  var outCache = this._node_edges[edge.nodes[0]].out,
      outCacheIdx = outCache.indexOf(edgeId),
      inCache = this._node_edges[edge.nodes[1]].in,
      inCacheIdx = inCache.indexOf(edgeId);

  if((outCacheIdx === -1) || (inCacheIdx === -1)) {
    console.log(outCache, inCache, edgeId);
    throw new Error('Internal error');
  }

  outCache.splice(outCacheIdx, 1);
  inCache.splice(inCacheIdx, 1);
};

// Remove the node with id nodeId. Removes any edges which join to that node.
// Throws if the node is not in the graph.
DirectedGraph.prototype.removeNode = function(nodeId) {
  var self = this, node = this.nodeMap[nodeId];
  if(!node) {
    throw new Error('Node id ' + nodeId + ' is not in the graph.');
  }

  // Work out which edges to remove
  this.nodeEdges(nodeId).forEach(function(edgeId) {
    self.removeEdge(edgeId);
  });

  // Delete node itself
  delete this.nodeMap[nodeId];
  this.order--;
};

// Contract an edge. Throws if edgeId is not present in graph. Replaces the
// edge with node. Create new edges using edgeFactory function which is passed
// the ids of the from and to nodes.
DirectedGraph.prototype.contract = function(edgeId, node, edgeFactory) {
  var self = this, edge = this.edgeMap[edgeId], inNodes = [], outNodes = [],
    edgesToRemove = [], edgesToAdd;

  if(!edge) {
    throw new Error('Edge id ' + edgeId + ' is not in the graph.');
  }

  // Remove original edge
  this.removeEdge(edgeId);

  // Get combined list of in and out neighbouring nodes.
  inNodes = [];
  this.nodeInNeighbours(edge.nodes[0]).forEach(function(nId) {
    if(inNodes.indexOf(nId) === -1) { inNodes.push(nId); }
  });
  this.nodeInNeighbours(edge.nodes[1]).forEach(function(nId) {
    if(inNodes.indexOf(nId) === -1) { inNodes.push(nId); }
  });

  outNodes = [];
  this.nodeOutNeighbours(edge.nodes[0]).forEach(function(nId) {
    if(outNodes.indexOf(nId) === -1) { outNodes.push(nId); }
  });
  this.nodeOutNeighbours(edge.nodes[1]).forEach(function(nId) {
    if(outNodes.indexOf(nId) === -1) { outNodes.push(nId); }
  });

  // Remove in and out edges
  edgesToRemove = [];
  this.nodeEdges(edge.nodes[0]).forEach(function(edgeId) {
    if(edgesToRemove.indexOf(edgeId) === -1) { edgesToRemove.push(edgeId); }
  });
  this.nodeEdges(edge.nodes[1]).forEach(function(edgeId) {
    if(edgesToRemove.indexOf(edgeId) === -1) { edgesToRemove.push(edgeId); }
  });
  edgesToRemove.forEach(function(e) {
    self.removeEdge(e);
  });

  // Remove the old edge's nodes
  if(this.hasNodeId(edge.nodes[0])) { this.removeNode(edge.nodes[0]); }
  if(this.hasNodeId(edge.nodes[1])) { this.removeNode(edge.nodes[1]); }

  // Insert merged node and edges from in and out neighbours
  this.addNode(node);

  // Insert edges
  edgesToAdd = [];
  inNodes.forEach(function(n) {
    if(self.hasNodeId(n)) { edgesToAdd.push(edgeFactory(self, n, node.id)); } });
  outNodes.forEach(function(n) {
    if(self.hasNodeId(n)) { edgesToAdd.push(edgeFactory(self, node.id, n)); } });
  edgesToAdd.forEach(function(e) { self.addEdge(e); });

  var addedEdges = [];
  edgesToAdd.forEach(function(e) { addedEdges.push(e.id); });

  return { removed: edgesToRemove, added: addedEdges };
};

// Get {node, edge} {object, index} by id
DirectedGraph.prototype.getNodeById = function(id) { return this.nodeMap[id]; };
DirectedGraph.prototype.getEdgeById = function(id) { return this.edgeMap[id]; };

// Return the degree of a node
DirectedGraph.prototype.degree = function(nodeId) {
  return this.outDegree(nodeId) + this.inDegree(nodeId);
};

// Return the "in" degree (number of ingoing edges) of node
DirectedGraph.prototype.inDegree = function(nodeId) {
  var edge_record = this._node_edges[nodeId];
  if(!edge_record) { throw new Error('Bad node id: ' + nodeId); }
  return edge_record.in ? edge_record.in.length : 0;
};

// Return the "out" degree (number of outgoing edges) of node
DirectedGraph.prototype.outDegree = function(nodeId) {
  var edge_record = this._node_edges[nodeId];
  if(!edge_record) { throw new Error('Bad node id: ' + nodeId); }
  return edge_record.out ? edge_record.out.length : 0;
};

// Get {,out,in} edge ids of node
DirectedGraph.prototype.nodeEdges = function(nodeId) {
  return [].concat(
      this.nodeInEdges(nodeId),
      this.nodeOutEdges(nodeId)
  );
};
DirectedGraph.prototype.nodeInEdges = function(nodeId) {
  var edge_record = this._node_edges[nodeId];
  if(!edge_record) { throw new Error('Bad node id: ' + nodeId); }
  return edge_record.in;
};
DirectedGraph.prototype.nodeOutEdges = function(nodeId) {
  var edge_record = this._node_edges[nodeId];
  if(!edge_record) { throw new Error('Bad node id: ' + nodeId); }
  return edge_record.out;
};

// Get {,out,in} neighbours of node. Out neighbours are those joined by an out
// edge and in neighbours are those joined by an in edge.
DirectedGraph.prototype.nodeNeighbours = function(nodeId) {
  return [].concat(this.nodeInNeighbours(nodeId), this.nodeOutNeighbours(nodeId));
};
DirectedGraph.prototype.nodeInNeighbours = function(nodeId) {
  var self = this, neighbours = [];
  this.nodeInEdges(nodeId).forEach(function(e) {
    neighbours.push(self.edgeMap[e].nodes[0]);
  });
  return neighbours;
};
DirectedGraph.prototype.nodeOutNeighbours = function(nodeId) {
  var self = this, neighbours = [];
  this.nodeOutEdges(nodeId).forEach(function(e) {
    neighbours.push(self.edgeMap[e].nodes[1]);
  });
  return neighbours;
};

// INPLACE graph simplification. Work in progress.
DirectedGraph.prototype.simplify = function(minimumLength, options) {
  var nNewNodes = 0, nNewEdges = 0;

  options = _extend({
    edgeLengthField: 'length',
    nodePositionField: 'pos',
    lengthFunc: function(edge) { return edge.data[options.edgeLengthField]; },

    mergedNodeIdPrefix: 'mergedNode',
    mergedNodeFunc: function(graph, edge, nodes) {
      var p1 = nodes[0].data[options.nodePositionField],
          p2 = nodes[1].data[options.nodePositionField],
          newNode, newNodeId;

      do {
        newNodeId = options.mergedNodeIdPrefix + (++nNewNodes);
      } while(graph.hasNodeId(newNodeId));

      newNode = { id: newNodeId, data: { } };

      newNode.data[options.nodePositionField] = [
        0.5 * (p1[0] + p2[0]), 0.5 * (p1[1] + p2[1])
      ];

      return newNode;
    },

    edgeDataFunc: function(edge, nodes) {
      var n1 = nodes[0].data[options.nodePositionField],
          n2 = nodes[1].data[options.nodePositionField],
          dx = n2[0] - n1[0], dy = n2[1] - n1[1],
          data = _extend({}, edge.data);

      data[options.edgeLengthField] = Math.sqrt(dx*dx + dy*dy);
      return data;
    },
  }, options);

  var self = this, nextEdge, collapseResult, edge, idx, mergedNode;

  // Keep a Heap of edges sorted by length
  var heap = new Heap(function(a,b) { return a.len - b.len; });

  // Add all graph edges to heap
  self.getEdges().forEach(function(e) {
    heap.push({ id: e.id, len: options.lengthFunc(e) });
  });

  var edgeFactory = function(graph, n1, n2) {
    var p1 = graph.getNodeById(n1).data.pos,
        p2 = graph.getNodeById(n2).data.pos,
        dx = p2[0]-p1[0], dy = p2[1]-p1[1],
        newId;

    do {
      newId = 'newEdge' + (++nNewEdges);
    } while(graph.hasEdgeId(newId));

    return {
      id: newId, nodes: [n1, n2],
      data: { length: Math.sqrt(dx*dx + dy*dy) },
    };
  };

  // Keep contracting edges until none smaller than minimumLength
  while(true) {
    nextEdge = heap.pop();

    // skip edges which are no longer in the graph
    if(!self.hasEdgeId(nextEdge.id)) { continue; }

    // stop when we get a long enough edge
    if(nextEdge.len >= minimumLength) { break; }

    // collapse edge
    edge = self.getEdgeById(nextEdge.id);
    mergedNode = options.mergedNodeFunc(self, edge,
        [self.getNodeById(edge.nodes[0]), self.getNodeById(edge.nodes[1])]);
    collapseResult = self.contract(nextEdge.id, mergedNode, edgeFactory);

    // add new edges to heap
    for(idx=0; idx<collapseResult.added.length; ++idx) {
      edge = self.getEdgeById(collapseResult.added[idx]);
      heap.push({ id: edge.id, len: options.lengthFunc(edge) });
    }
  }

  return self;
};

// Construct a GeoJSON representation of the graph edges as a GeoJSON
// FeatureCollection of LineStrings, one for each edge. Each LineString has the
// edge's data field as the "properties". nodePosFunc is a function which takes
// a node object and returns a pair specifying the co-ordinates of that node.
DirectedGraph.prototype.edgesAsGeoJSON = function(nodePosFunc) {
  var features = [], edge, coords,
      featureCollection = { type: 'FeatureCollection', features: features };

  var lineStrings = []
  for(var edgeId in this.edgeMap) {
    edge = this.edgeMap[edgeId];
    lineStrings.push([
      nodePosFunc(this.getNodeById(edge.nodes[0])),
      nodePosFunc(this.getNodeById(edge.nodes[1])),
    ]);
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'MultiLineString',
      coordinates: lineStrings,
    },
  };
};

return DirectedGraph;
})();
