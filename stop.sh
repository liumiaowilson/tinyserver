pid=`ps aux | grep server.js | grep -v grep | awk -F' ' '{print $2}'`
kill -9 $pid
