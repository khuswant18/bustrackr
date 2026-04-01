import express from "express"
import 'dotenv/config'

const app = express()

const PORT = process.env.PORT 

app.get('/',(req,res)=>{
    res.send("Server is healthy")
})

app.listen(()=>{
    console.log("server is running on port",PORT)
})
