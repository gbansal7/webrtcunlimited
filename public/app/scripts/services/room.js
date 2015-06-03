/* global RTCIceCandidate, RTCSessionDescription, RTCPeerConnection, EventEmitter */
'use strict';

/**
 * @ngdoc service
 * @name publicApp.Room
 * @description
 * # Room
 * Factory in the publicApp.
 */
angular.module('publicApp')
  .factory('Room', function ($rootScope, $q, Io, config, $location, $http) {

    var iceConfig = { 'iceServers': [{ 'url': 'stun:stun.l.google.com:19302' }]},
        peerConnections = {}, dataChannel={},
        localDataChannel, remoteDataChannel,
        currentId, roomId,
        stream
        var receiveBuffer = [];
        var filesize = 0;
        var filename;
        var receivedSize=0;

        var bytesPrev = 0;
        var timestampPrev = 0;
        var timestampStart;
        var statsInterval = null;
        var bitrateMax = 0;
        var bitrateDiv = document.querySelector('div#files');
    function getPeerConnection(id) {
      if (peerConnections[id]) {
        return peerConnections[id];
      }
      var pc = new webkitRTCPeerConnection(iceConfig,{ optional:[{ DtlsSrtpKeyAgreement:true }]});

      peerConnections[id] = pc;
      pc.addStream(stream);
      pc.onicecandidate = function (evnt) {
        socket.emit('msg', { by: currentId, to: id, ice: evnt.candidate, type: 'ice' });
      };
      pc.onaddstream = function (evnt) {
        console.log('Received new stream');
        api.trigger('peer.stream', [{
          id: id,
          stream: evnt.stream
        }]);
        if (!$rootScope.$$digest) {
          $rootScope.$apply();
        }
      };

      localDataChannel = pc.createDataChannel("sendDataChannel",{ordered: false,  maxRetransmitTime: 3000});
      localDataChannel.binaryType = 'arraybuffer';
      localDataChannel.onerror = function (error) {
        console.log("Data Channel Error:", error);
      };

      localDataChannel.onmessage = function (event) {
        console.log("Got Data Channel Message:", event.data);
          if(typeof event.data == "string"){
            var mydata = event.data;
            mydata = JSON.parse(mydata);
            if(mydata.type == "file"){
              filesize = mydata.size;
              filename = mydata.name;
            }else{
              alert(mydata.msg);
            }
           // console.log(mydata);
          }else{
              receiveBuffer.push(event.data);
            //receivedSize += event.data.byteLength;
            
            console.log("file size", filesize);
            console.log("filename", filename);
            

            if(isNaN(receivedSize)){
              receivedSize=0;
            }
            var currentreceviedSize =  event.data.byteLength;
            receivedSize = receivedSize+parseInt(currentreceviedSize);
            console.log("currentreceviedSize",currentreceviedSize);
            console.log("receivedSize", receivedSize);
            if (receivedSize === filesize) { //filesize 549841
              var received = new window.Blob(receiveBuffer);
              receiveBuffer = [];
              var downloadDiv = document.createElement('a');
              downloadDiv.href = URL.createObjectURL(received);
              downloadDiv.download = filename;
              var text = 'Click to download \'' + filename + '\' (' +filesize +' bytes)';
              downloadDiv.appendChild(document.createTextNode(text));
              downloadDiv.style.display = 'block';
              bitrateDiv.appendChild(downloadDiv);
              receivedSize=0;
              //alert("complete in loca");
            }
          }
            
      };

      localDataChannel.onopen = function (event) {
          var readyState = localDataChannel.readyState;
          if (readyState == "open") {
            localDataChannel.send("Hello World!");
          }else{
            console.log("channel is "+readyState);
          }
      };

      localDataChannel.onclose = function () {
        console.log("The Data Channel is Closed");
      };
      dataChannel[id] = localDataChannel;
      
      return pc;
    }

    function makeOffer(id) {
      var pc = getPeerConnection(id);
      pc.createOffer(function (sdp) {
        pc.setLocalDescription(sdp);
        console.log('Creating an offer for', id);
        socket.emit('msg', { by: currentId, to: id, sdp: sdp, type: 'sdp-offer' });
      }, function (e) {
        console.log(e);
      },
      { mandatory: { OfferToReceiveVideo: true, OfferToReceiveAudio: true }});
    }

    function handleMessage(data) {
      var pc = getPeerConnection(data.by);
      pc.ondatachannel = function(){
          remoteDataChannel = event.channel;
          remoteDataChannel.onmessage = function(event) {
            console.log(event.data);
           receiveBuffer.push(event.data);
            if(isNaN(receivedSize)){
              receivedSize=0;
            }
            var currentreceviedSize =  event.data.byteLength;
            receivedSize = receivedSize+parseInt(currentreceviedSize);
            console.log("currentreceviedSize",currentreceviedSize);
            if (receivedSize === filesize) { //filesize 549841
              var received = new window.Blob(receiveBuffer);
              receiveBuffer = [];
              var downloadDiv = document.createElement('a');
              downloadDiv.href = URL.createObjectURL(received);
              downloadDiv.download = filename;
              var text = 'Click to download \'' + filename + '\' (' +filesize +' bytes)';
              downloadDiv.appendChild(document.createTextNode(text));
              downloadDiv.style.display = 'block';
              bitrateDiv.appendChild(downloadDiv);
              receivedSize=0;
              //alert("complete in loca");
            }
          };

          dataChannel[data.by]= remoteDataChannel;
      };
      
      switch (data.type) {
        case 'sdp-offer':
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {
            console.log('Setting remote description by offer');
            pc.createAnswer(function (sdp) {
              pc.setLocalDescription(sdp);
              socket.emit('msg', { by: currentId, to: data.by, sdp: sdp, type: 'sdp-answer' });
            });
          });
          break;
        case 'sdp-answer':
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {
            console.log('Setting remote description by answer');
          }, function (e) {
            console.error(e);
          });
          break;
        case 'ice':
          if (data.ice) {
            console.log('Adding ice candidates');
            pc.addIceCandidate(new RTCIceCandidate(data.ice));
          }
          break;
      }
    }

    var socket = Io.connect(config.SIGNALIG_SERVER_URL),
        connected = false;

        socket.on('filedetails', function(data){
          console.log("in filedetails ",data);
          data = JSON.parse(data);
          filesize = data.size;
          filename = data.name;
        });

    function addHandlers(socket) {
      socket.on('peer.connected', function (params) {
        makeOffer(params.id);
      });
      socket.on('peer.disconnected', function (data) {
        api.trigger('peer.disconnected', [data]);
        if (!$rootScope.$$digest) {
          $rootScope.$apply();
        }
      });
      socket.on('msg', function (data) {
        handleMessage(data);
      });
    }

    var api = {
      joinRoom: function (r) {
        if (!connected) {
          socket.emit('init', { room: r }, function (roomid, id) {
            currentId = id;
            roomId = roomid;
          });
          connected = true;
        }
      },
      createRoom: function () {
        var d = $q.defer();
        socket.emit('init', null, function (roomid, id) {
          d.resolve(roomid);
          roomId = roomid;
          currentId = id;
          connected = true;
        });
        return d.promise;
      },
      init: function (s) {
        stream = s;
      },
      sendmsg: function(data, peerid){
        console.log("Number of channels",dataChannel);
         for(var key in dataChannel){
            if(dataChannel[key].readyState == "open"){
                dataChannel[key].send(data);
            }
            
         }
      },
      sendtextmsg: function(data){
         for(var key in dataChannel){
            if(dataChannel[key].readyState == "open"){
                dataChannel[key].send(data);
            }
            
         }
      },
      sendfiledetails: function(data){
        socket.emit('filedetails',data,function(resolve){
          return resolve;
        });
      }
    };
    EventEmitter.call(api);
    Object.setPrototypeOf(api, EventEmitter.prototype);

    addHandlers(socket);
    return api;
  });
