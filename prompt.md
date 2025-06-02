先给model.py中新增一个保存模型的方法，保存为json文件，文件名叫做model.json。

在predict.py中使用model.py的方法，并构造一个简单http服务。初始化时，加载model.json文件，初始化模型，并且支持配置一个demo_id的参数，默认读取data/run_sample_10000中的一条跑步记录作为演示数据demo_item,仅仅使用其中的 heart_rate = np.array(data['tar_heart_rate'])，speed = np.array(data['tar_derived_speed'])，timestamp = np.array(data['timestamp'])。且df = df.sort_values('timestamp').reset_index(drop=True)。但需要注意timestamp原本是1372372194,1372372199这样的时间戳数据,转化为距离第一个时间戳过去了多少秒，用一个列叫做origin_timestamp来表示

有一个demo_predict的api，前端会轮询这个api，包含一个idx参数和一个duration参数，读取demo_item[idx]为结尾的往前的duration秒数据（通过origin_timestamp列来判断，不足duration秒的，则直接返回），作为输入，预测接下来的duration秒数据，返回预测的speed，以及下一次预测的idx。

还有一个demo_data的api，前端会轮询这个api，包含一个t参数，读取demo_item中origin_timestamp和t最接近的行，返回给前端。

