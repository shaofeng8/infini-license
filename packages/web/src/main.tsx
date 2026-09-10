import { message } from 'antd'
import 'antd/dist/reset.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// 并发请求出错时会各弹一条，叠满整屏。后台的批量操作很容易触发
message.config({ maxCount: 3 })

createRoot(document.getElementById('root')!).render(<App />)
