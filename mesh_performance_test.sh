# Copyright (c) 2016 by Solectria, A Yashkawa Company. All rights reserved.

# History: 2016-11-15 initial version

# The script identifies neighbors from /etc/solectria/network/network_map.json file
# It is assumed that IP address is stored as the 2nd field in each row
# The script pings each neighboring terminal and estimates the latency and loss percentage
# The upload and download throughput are determined using iperf
# The results are displayed in table format in command line and also stored as key-value pairs in Nw_perf.json file

# Methodology:
# ------------
# An iperf server deamon is waiting in every terminal
# The default port 5001 is having issues with bodirectional address binding. 
# So the iperf server is made to wait in port 13130
# One terminal (probably the gateway) acts as the iperf client and connects with each iperf server running 
# in the available neighbors: This gives the upload throughput
# The download through is determined by reversing the client server roles

# Need to add handler for "Warning: Permanently added '10.15.140.246' (ECDSA) to the list of known hosts"
# Need to add handler for timeout scenario

# Function to restrict the span of each command
# This function avoids the long pause if the connection could not be extablished with the neighbor

# Modes of running:
# 1. Quick (skips throughput computation); Avg span: 7 secs/node
# 2. Extensive (includes throughput computation); Avg span: 25 secs/node - linearly increases with the network size

f_tout () {
        $1 &
        sleep $2
        kill $!
}

function clean_up() {
	echo "...performing house keeping"
	rm -r /home/service/logs
	f_tout 'nohup iperf -s &' 8
	exit 0
}

echo "Mesh network performace analysis"
echo "--------------------------------"

echo "... Creating required directories and files"
rm -Rf /home/service/logs
rm /home/service/Nw_perf.json 2>/dev/null
mkdir /home/service/logs
echo "stopping iperf instance"
x=$(ps -ef | grep 'iperf')
kill $(echo $x |head -n2 | tail -n1 | awk -F " " '{print $2 }') 2> /dev/null

# Array stores the parameter string and calculated value in subsequent positions                                                    
arr=
# Array index
count=0
echo "... Identifying neighbors"
grep "ipv4" /etc/solectria/network/network_map.json | awk -F ',' '{print $2}' |awk -F ':' '{print $2}' | sed 's,..\(.*\).$,\1,g' > /home/service/logs/f1
n_nodes=$(cat /home/service/logs/f1 | wc -l )

echo "Choose the desired mode of run:"
echo "1. Quick mode (Throughput computation not included; max runtime: $(( $n_nodes*9)) secs)"
echo "2. Extensive mode (Throughput computation included; max runtime: "$(( $n_nodes/2))" min )" 
read choice

if [ $choice != "1" ] && [ $choice != "2" ]; then
	echo "Input not recognized! terminating..." 
	exit 1
fi

# For each neighbor identified:
for ip in $(cat  /home/service/logs/f1); do
echo "...Pinging $ip"
ping -c4 $ip >  /home/service/logs/f2 && echo "Node linked"
if [ $? -ne 0 ]; then 
	echo "No_link"; 
	continue; 
fi 
arr[$count]="IP_addr" && ((count++))

# Loss estimate:
echo "...Computing Loss percentage"
arr[$count]="$ip" && ((count++))
arr[count]="Loss(%%)" && ((count++)) 
arr[count]=$(grep 'received' /home/service/logs/f2 |awk -F "," 'match($0,/packet loss/) {print substr($0, RSTART-4, 3)}' |sed -e "s/^00/100/" |sed 's/.$//') && ((count++))

echo "...Computing latency"
# print the average latency in ms:                                           
arr[count]="Latency(ms)" && ((count++))
arr[count]=$(cat  /home/service/logs/f2 | grep 'rtt' | awk -F ' ' '{print $4}' | awk -F '/' '{print $2}') && ((count++))

if [ $choice == "1" ]; then
	continue; 
else
#Initializing temporary array to store the iperf output strings
y=                                                                              
i=0;     
echo "...Computing upload throughput"
# To print throughput in Mbps:                                           
arr[count]="Upload"  && ((count++))
iperf -c $ip -d > logs/f3 2> logs/ferr
#f_tout 'iperf -c $ip -d' 26 1> /home/service/logs/f3 2> /home/service/logs/ferr
 if (grep "failed" logs/ferr) ; then
 echo "iperf server not running! Skipping throughput computations..."
 arr_tmp=(" - " "Download " " - ")
 arr=("${arr[@]}" "${arr_tmp[@]}")
 count=$((count+3))
 continue;
 continue
fi
arr[count]="$(cat /home/service/logs/f3 |grep "bits/sec"|awk 'NR==1 {print $(NF-1)$NF}')" && ((count++))

echo "...Computing download throughput"
arr[count]="Download" && ((count++))
arr[count]="$(tail -1 /home/service/logs/f3 | awk -F ' ' '{print $(NF-1)$NF}')" && ((count++))
fi
echo "------------------------------"
done              
echo                                                              
echo "RESULTS:"
echo "--------------------------------------------------"                                                              
# ==================
# Output formatting:
# ==================
echo "The results are also stored in Nw_perf.json"                                       

width=43
vars=(${arr[@]})
len=${#arr[@]}

if [ $choice == "1" ]; then
	header="\n %-15s |%-12s |%-12s\n"                                 
	format=" %-15s |%-12s |%-12s\n"


	printf "$header" "IP_addr" " Loss(%) " "Latency(ms)"
	printf "%$width.${width}s\n"
	for (( i=0; i <${#arr[@]}; i=i+6)); do
        	printf "$format" ${arr[$i+1]} ${arr[$i+3]} ${arr[$i+5]}
	done
elif [ $choice == "2" ]; then 
	header="\n %-15s |%-12s |%-12s |%-16s |%-16s\n"                                 
	format=" %-15s |%-12s |%-12s |%-16s |%-16s\n"                                   
	printf "$header" "IP_addr" " Loss(%) " "Latency(ms)" "  Upload  " "  Download  "
	printf "%$width.${width}s\n"
	for (( i=0; i <${#arr[@]}; i=i+10)); do
        	printf "$format" ${arr[$i+1]} ${arr[$i+3]} "${arr[$i+5]}" "${arr[$i+7]}" "${arr[$i+9]}"
	done
fi
	# Generation of Nw_perf.json file

	(printf "\n{\"network\": {\n\t \"mesh\":{\n\t\t \"performance\":[\n"
	for (( i=0; i<$len; i+=2 )); do
		if (( $i == 0 )); then
			printf "\t\t{"
		fi                                                                       
    		printf "\"${arr[i]}\": \"${vars[i+1]}\""
		j=$((i+2))
		if [ $choice == "1" ] && (( $j % 6 == 0 && $i < $((len-2)) )); then
			 printf "},\n\t\t{"
        	elif [ $choice == "2" ] && (( $j % 10 == 0 && $i < $((len-2)) ));  then
			printf "},\n\t\t{"
		elif (( $i == $((len-2)) )); then
        	        printf "} \n \t\t\t]\n\t\t}\n\t}\n"
		elif [ $i -lt $((len-2)) ] ; then
		        printf ","
		fi
	done                                                                            
	printf "}\n") > Nw_perf.json          
clean_up
