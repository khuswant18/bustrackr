import express from "express"
import 'dotenv/config'

const app = express()

const PORT = process.env.PORT || 4000

app.get('/',(req,res)=>{
    res.send("Server is healthy")
})

app.listen(PORT,()=>{
    console.log("server is running on port",PORT)
})
